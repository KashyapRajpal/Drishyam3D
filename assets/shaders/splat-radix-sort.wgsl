// GPU depth sort for Gaussian splats (4 x 8-bit LSD radix sort).
//
// Exact alternative to the bitonic sort in splat-sort.wgsl: O(N) work in ~13
// dispatches instead of O(N log²N) over O(log²N) dispatches, with no
// power-of-two padding. Mirrors ordering/radix-reference.js, which is unit-tested
// in __tests__/radix-sort.test.js — the same JS-first pattern as
// spatial/frustum.js ↔ splat-cull.wgsl. See docs/splat-radix-sort.md.
//
// Pipeline per frame:
//   compute_keys (splat-sort.wgsl, reused)  → f32 depth keys + indices[i]=i
//   reduction.maskKeys (splat-cull.wgsl)    → sinks culled keys to FAR_KEY
//   encode_keys                             → f32 keys → order-preserving u32
//   4 x { histogram → scan_hist → scatter } → sorted indices
//
// The f32 key buffer stays the shared contract, so splat-cull.wgsl and
// culled-reduction.js are untouched and Culled+Radix composes for free.
//
// Ping-pong lives in *offsets*, not bindings: keysU32 and idx are each 2*padded
// long, and inBase/outBase select halves per pass. Bindings never change, so one
// bind group per pass (differing only in its uniform slice) drives everything.

struct RadixParams {
    padded     : u32, // count rounded up to a whole BLOCK
    blockCount : u32, // padded / BLOCK
    // NOT `pass` — that is a reserved WGSL keyword, and naming it so makes the
    // whole module fail to parse. Every pipeline is then created invalid, which
    // surfaces only as a console *warning* and an unsubmittable command buffer.
    digitPass  : u32, // 0..3 — which byte of the key this pass sorts on
    inBase     : u32, // element offset of this pass's input half
    outBase    : u32, // element offset of this pass's output half
    _pad0      : u32,
    _pad1      : u32,
    _pad2      : u32,
}

@group(0) @binding(0) var<uniform>             rp      : RadixParams;
@group(0) @binding(1) var<storage, read>       keysF32 : array<f32>;
@group(0) @binding(2) var<storage, read_write> keysU32 : array<u32>;
@group(0) @binding(3) var<storage, read_write> idx     : array<u32>;
@group(0) @binding(4) var<storage, read_write> hist    : array<u32>;

const RADIX_BITS    : u32 = 8u;
const RADIX_BUCKETS : u32 = 256u;
const WORKGROUP     : u32 = 256u;
const ITEMS         : u32 = 16u;   // items per invocation
const BLOCK         : u32 = 4096u; // WORKGROUP * ITEMS

/**
 * Order-preserving f32 → u32. Positives ascend as integers but sit below
 * negatives in raw bits, so flipping the sign bit lifts them above; negatives
 * ascend backwards as integers, so inverting every bit both reverses them and
 * drops them below the positives. Ascending u32 order then equals ascending f32
 * order — i.e. farthest (most negative view z) first, back-to-front.
 *
 * FAR_KEY (3e38, written by compute_keys padding and by apply_cull) is a large
 * positive float, so it maps near 0xFFFFFFFF and sinks past the visible set for
 * free — which is the whole reason the cull path needs no changes.
 */
fn orderable(f : f32) -> u32 {
    let u = bitcast<u32>(f);
    let mask = select(0x80000000u, 0xFFFFFFFFu, (u & 0x80000000u) != 0u);
    return u ^ mask;
}

fn digitOf(key : u32, p : u32) -> u32 {
    return (key >> (p * RADIX_BITS)) & (RADIX_BUCKETS - 1u);
}

// ---------------------------------------------------------------------------
// encode_keys — f32 depth keys → orderable u32, into the pass-0 input half.
// ---------------------------------------------------------------------------
@compute @workgroup_size(256)
fn encode_keys(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= rp.padded) { return; }
    keysU32[rp.inBase + i] = orderable(keysF32[i]);
}

// ---------------------------------------------------------------------------
// histogram — per-block digit counts, written digit-major.
//
// Digit-major (`hist[digit * blockCount + block]`) is what lets ONE exclusive
// scan of the whole matrix hand every (digit, block) pair its global destination
// base. Row-major would need a second pass to fold in the digit totals.
// ---------------------------------------------------------------------------
var<workgroup> localHist : array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn histogram(
    @builtin(workgroup_id) wid : vec3<u32>,
    @builtin(local_invocation_id) lid : vec3<u32>,
) {
    atomicStore(&localHist[lid.x], 0u);
    workgroupBarrier();

    let blockStart = wid.x * BLOCK;
    for (var k = 0u; k < ITEMS; k = k + 1u) {
        // Strided (k*256 + lid), not contiguous per thread: adjacent invocations
        // touch adjacent addresses, so each round is one coalesced read.
        let i = blockStart + k * WORKGROUP + lid.x;
        if (i < rp.padded) {
            atomicAdd(&localHist[digitOf(keysU32[rp.inBase + i], rp.digitPass)], 1u);
        }
    }
    workgroupBarrier();

    hist[lid.x * rp.blockCount + wid.x] = atomicLoad(&localHist[lid.x]);
}

// ---------------------------------------------------------------------------
// scan_hist — exclusive prefix sum over the whole histogram matrix.
//
// ONE workgroup, dispatched once: each invocation serially reduces a contiguous
// chunk, the 256 chunk-sums are scanned in shared memory, then each invocation
// re-walks its chunk writing the running offsets back in place. The matrix is
// only 256 x blockCount (39k entries at 624k splats), so a single workgroup
// clears it comfortably and no cross-workgroup synchronisation is needed —
// which WebGPU has no primitive for anyway.
// ---------------------------------------------------------------------------
var<workgroup> partial : array<u32, 256>;

@compute @workgroup_size(256)
fn scan_hist(@builtin(local_invocation_id) lid : vec3<u32>) {
    let total = RADIX_BUCKETS * rp.blockCount;
    let chunk = (total + WORKGROUP - 1u) / WORKGROUP;
    let start = min(lid.x * chunk, total);
    let end   = min(start + chunk, total);

    var sum = 0u;
    for (var i = start; i < end; i = i + 1u) { sum = sum + hist[i]; }
    partial[lid.x] = sum;
    workgroupBarrier();

    // Hillis-Steele inclusive scan of the chunk sums. Barriers sit in uniform
    // control flow (outside the guards), as WGSL requires.
    for (var offset = 1u; offset < WORKGROUP; offset = offset << 1u) {
        var v = 0u;
        if (lid.x >= offset) { v = partial[lid.x - offset]; }
        workgroupBarrier();
        if (lid.x >= offset) { partial[lid.x] = partial[lid.x] + v; }
        workgroupBarrier();
    }

    var running = 0u;
    if (lid.x > 0u) { running = partial[lid.x - 1u]; }

    for (var i = start; i < end; i = i + 1u) {
        let c = hist[i];
        hist[i] = running;
        running = running + c;
    }
}

// ---------------------------------------------------------------------------
// scatter — move each element to base[digit][block] + its rank within the block.
//
// The scanned bases partition the output exactly, so blocks never collide and no
// global atomics are needed; the shared cursor only assigns unique slots inside
// one block's slice.
//
// NOT stable: atomicAdd hands out ranks in arbitrary order, so elements sharing
// a digit within a block may swap. Harmless for depth order — it only reorders
// splats whose 32-bit keys are bit-identical, which bitonic leaves unordered too
// (see the tie caveat in docs/splat-radix-sort.md).
// ---------------------------------------------------------------------------
var<workgroup> cursor    : array<atomic<u32>, 256>;
var<workgroup> blockBase : array<u32, 256>;

@compute @workgroup_size(256)
fn scatter(
    @builtin(workgroup_id) wid : vec3<u32>,
    @builtin(local_invocation_id) lid : vec3<u32>,
) {
    atomicStore(&cursor[lid.x], 0u);
    // Cache this block's 256 bases once, instead of one global read per element.
    blockBase[lid.x] = hist[lid.x * rp.blockCount + wid.x];
    workgroupBarrier();

    let blockStart = wid.x * BLOCK;
    for (var k = 0u; k < ITEMS; k = k + 1u) {
        let i = blockStart + k * WORKGROUP + lid.x;
        if (i < rp.padded) {
            let key = keysU32[rp.inBase + i];
            let d = digitOf(key, rp.digitPass);
            let dst = blockBase[d] + atomicAdd(&cursor[d], 1u);
            keysU32[rp.outBase + dst] = key;
            idx[rp.outBase + dst] = idx[rp.inBase + i];
        }
    }
}
