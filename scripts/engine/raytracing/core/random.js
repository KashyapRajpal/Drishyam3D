export const ZERO_SEED_FALLBACK = 0x6d2b79f5;

/** Explicit mutable RNG state. Keep one state object per sample stream. */
export function createRng(seed) {
    if (!Number.isFinite(seed)) throw new Error('RNG seed must be finite.');
    const state = seed >>> 0;
    return { state: state === 0 ? ZERO_SEED_FALLBACK : state };
}

/** xorshift32; returns the next unsigned state and updates rngState in place. */
export function nextUint32(rngState) {
    if (!rngState || !Number.isInteger(rngState.state)) {
        throw new Error('nextUint32 requires an explicit RNG state.');
    }
    let value = rngState.state >>> 0;
    if (value === 0) value = ZERO_SEED_FALLBACK;
    value = (value ^ (value << 13)) >>> 0;
    value = (value ^ (value >>> 17)) >>> 0;
    value = (value ^ (value << 5)) >>> 0;
    rngState.state = value;
    return value;
}

/** Uniform value in [0, 1), using the same top-24-bit conversion as WGSL. */
export function nextFloat(rngState) {
    return (nextUint32(rngState) >>> 8) * (1 / 16777216);
}
