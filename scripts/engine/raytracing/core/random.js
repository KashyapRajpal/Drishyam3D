export const ZERO_SEED_FALLBACK = 0x6d2b79f5;

const PIXEL_X_SEED_MULTIPLIER = 0x9e3779b9;
const PIXEL_Y_SEED_MULTIPLIER = 0x85ebca6b;
const SAMPLE_SEED_MULTIPLIER = 0xc2b2ae35;

/**
 * Derives the per-path seed shared by the CPU worker and the WGSL integrator.
 * Keep these multipliers in sync with cs_raytrace in raytrace.wgsl.
 */
export function pixelSampleSeed(baseSeed, pixelX, pixelY, sampleIndex) {
    if (![baseSeed, pixelX, pixelY, sampleIndex].every(Number.isInteger)) {
        throw new Error('Pixel sample seed inputs must be integers.');
    }
    return (
        (baseSeed >>> 0)
        ^ Math.imul(pixelX >>> 0, PIXEL_X_SEED_MULTIPLIER)
        ^ Math.imul(pixelY >>> 0, PIXEL_Y_SEED_MULTIPLIER)
        ^ Math.imul(sampleIndex >>> 0, SAMPLE_SEED_MULTIPLIER)
    ) >>> 0;
}

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
