/**
 * @file CPU reference for the GPU radix sort — ordering milestone C.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Plain-JS implementation of the exact algorithm `splat-radix-sort.wgsl` will
 * run: encode f32 depth keys to order-preserving u32, then 4 × 8-bit LSD passes
 * of histogram → digit-major exclusive scan → stable scatter. Unit-tested in
 * __tests__/radix-sort.test.js, so a GPU disagreement localises to the shader
 * rather than to the design — the same JS-first pattern as
 * spatial/frustum.js ↔ splat-cull.wgsl.
 *
 * Not imported by the renderer at runtime; the GPU does the real work. Kept here
 * next to the backend it specifies (see docs/splat-radix-sort.md).
 */

export const RADIX_BITS = 8;
export const RADIX_BUCKETS = 1 << RADIX_BITS; // 256 digit values per pass
export const RADIX_PASSES = 32 / RADIX_BITS;  // 4 passes covers a 32-bit key

/**
 * Elements per block: 256 invocations × 16 items. Chosen so the histogram
 * matrix (RADIX_BUCKETS × blockCount) stays small enough for a two-level scan —
 * at 1.36M splats that is 256 × 333 = 85,248 entries. The GPU must use this
 * value; tests override it to exercise multi-block paths cheaply.
 */
export const BLOCK_SIZE = 4096;

/** Sentinel for padding/culled entries. Must match splat-sort.wgsl + splat-cull.wgsl. */
export const FAR_KEY = 3.0e38;

// Shared scratch for bit reinterpretation (f32 ↔ u32).
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/**
 * Maps an IEEE-754 f32 to a u32 whose unsigned order matches the float's
 * ascending order — the transform the whole milestone rests on.
 *
 * Positives already ascend as integers but sit below negatives in raw bits, so
 * flipping the sign bit lifts them above. Negatives ascend *backwards* as
 * integers (more negative = larger magnitude = larger u32), so inverting every
 * bit both reverses them and drops them below the positives.
 *
 * Note ±0: they compare equal as floats but map to distinct u32 (−0 → 0x7FFFFFFF,
 * +0 → 0x80000000), so −0 sorts just before +0. Deterministic, and harmless for
 * depth keys. NaN is not handled — a NaN key is an upstream bug.
 *
 * @param {number} f
 * @returns {number} u32
 */
export function orderableFromFloat(f) {
    _f32[0] = f;
    const u = _u32[0];
    const mask = (u & 0x80000000) !== 0 ? 0xffffffff : 0x80000000;
    return (u ^ mask) >>> 0;
}

/**
 * Inverse of {@link orderableFromFloat}. Test/debug aid — the shader never needs it.
 * @param {number} u u32
 * @returns {number} f32
 */
export function floatFromOrderable(u) {
    const mask = (u & 0x80000000) !== 0 ? 0x80000000 : 0xffffffff;
    _u32[0] = (u ^ mask) >>> 0;
    return _f32[0];
}

/** Next multiple of `block` at or above `n`. */
export function alignUp(n, block) {
    return Math.ceil(n / block) * block;
}

/** The 8-bit digit of `key` examined by `pass` (0 = least significant). */
export function digitOf(key, pass) {
    return (key >>> (pass * RADIX_BITS)) & (RADIX_BUCKETS - 1);
}

/**
 * Encodes f32 depth keys to orderable u32, padding the tail with FAR_KEY so
 * padding entries sink past the real count (as compute_keys already does on GPU).
 * @param {Float32Array} keysF32
 * @param {number} count real splat count
 * @param {number} padded total length, ≥ count
 * @returns {Uint32Array} length `padded`
 */
export function encodeKeys(keysF32, count, padded) {
    const out = new Uint32Array(padded);
    const farOrdered = orderableFromFloat(FAR_KEY);
    for (let i = 0; i < padded; i++) {
        out[i] = i < count ? orderableFromFloat(keysF32[i]) : farOrdered;
    }
    return out;
}

/**
 * Per-block digit histogram in **digit-major** layout: `hist[digit * blockCount + block]`.
 *
 * Digit-major is what makes a single exclusive scan of the whole matrix yield
 * every (digit, block) pair its global destination base — the reason the scan is
 * one pass and not two.
 *
 * @param {Uint32Array} keys length `padded`
 * @param {number} pass
 * @param {number} [blockSize]
 * @returns {Uint32Array} length RADIX_BUCKETS × blockCount
 */
export function histogram(keys, pass, blockSize = BLOCK_SIZE) {
    const blockCount = Math.ceil(keys.length / blockSize);
    const hist = new Uint32Array(RADIX_BUCKETS * blockCount);
    for (let b = 0; b < blockCount; b++) {
        const start = b * blockSize;
        const end = Math.min(start + blockSize, keys.length);
        for (let i = start; i < end; i++) {
            hist[digitOf(keys[i], pass) * blockCount + b]++;
        }
    }
    return hist;
}

/**
 * Exclusive prefix sum. On GPU this is the two-level scan (block scan → scan of
 * block sums → uniform add); the result is identical, so the reference stays flat.
 * @param {Uint32Array} arr
 * @returns {Uint32Array}
 */
export function exclusiveScan(arr) {
    const out = new Uint32Array(arr.length);
    let running = 0;
    for (let i = 0; i < arr.length; i++) {
        out[i] = running;
        running += arr[i];
    }
    return out;
}

/**
 * Stable scatter for one pass: each element lands at its (digit, block) base plus
 * its rank among same-digit elements earlier *in its own block*.
 *
 * The rank comes from a running per-block counter — on GPU, a workgroup-shared
 * counting scan. Deliberately not atomics: atomics would make the order
 * non-deterministic across frames and break stability on tied keys.
 *
 * @param {Uint32Array} keysIn @param {Uint32Array} idxIn
 * @param {Uint32Array} keysOut @param {Uint32Array} idxOut
 * @param {Uint32Array} base scanned digit-major offsets
 * @param {number} pass @param {number} [blockSize]
 */
export function scatter(keysIn, idxIn, keysOut, idxOut, base, pass, blockSize = BLOCK_SIZE) {
    const blockCount = Math.ceil(keysIn.length / blockSize);
    const cursor = new Uint32Array(RADIX_BUCKETS);
    for (let b = 0; b < blockCount; b++) {
        cursor.fill(0);
        const start = b * blockSize;
        const end = Math.min(start + blockSize, keysIn.length);
        for (let i = start; i < end; i++) {
            const digit = digitOf(keysIn[i], pass);
            const dst = base[digit * blockCount + b] + cursor[digit];
            cursor[digit]++;
            keysOut[dst] = keysIn[i];
            idxOut[dst] = idxIn[i];
        }
    }
}

/**
 * Full 4-pass LSD radix sort of splat indices by ascending depth key.
 *
 * Ascending order = most-negative view z (farthest) first = correct
 * back-to-front draw order, matching the bitonic backend it replaces.
 *
 * **Ping-pong parity is load-bearing.** RADIX_PASSES is even, so the result ends
 * back in the A buffers — which is why the GPU renderer's bind group, built once
 * against buffer A in prepare(), stays valid. All four passes must always run;
 * skipping a pass with a degenerate histogram (a common optimisation) would
 * leave the answer in the buffer nobody reads.
 *
 * @param {Float32Array} keysF32 view-space depth keys, one per splat
 * @param {number} count real splat count
 * @param {{ blockSize?: number }} [opts]
 * @returns {{ indices: Uint32Array, keys: Uint32Array, padded: number }}
 *          `indices`/`keys` have length `padded`; entries past `count` are padding.
 */
export function radixSortIndices(keysF32, count, { blockSize = BLOCK_SIZE } = {}) {
    const padded = alignUp(count, blockSize);

    let keysA = encodeKeys(keysF32, count, padded);
    let idxA = new Uint32Array(padded);
    for (let i = 0; i < padded; i++) idxA[i] = i;

    let keysB = new Uint32Array(padded);
    let idxB = new Uint32Array(padded);

    for (let pass = 0; pass < RADIX_PASSES; pass++) {
        const base = exclusiveScan(histogram(keysA, pass, blockSize));
        scatter(keysA, idxA, keysB, idxB, base, pass, blockSize);
        // Ping-pong: A always holds the current data at the top of a pass.
        [keysA, keysB] = [keysB, keysA];
        [idxA, idxB] = [idxB, idxA];
    }

    return { indices: idxA, keys: keysA, padded };
}
