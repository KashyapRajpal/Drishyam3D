import { buildAccelerationStructures } from '../acceleration/acceleration-structure.js';
import { generateCameraRay } from '../core/camera-rays.js';
import { createRng, nextFloat, pixelSampleSeed } from '../core/random.js';
import { traceSample } from './path-integrator.js';

const DEFAULT_REFERENCE_SETTINGS = Object.freeze({
    maxBounces: 4,
    seed: 0x12345678,
    spp: 1,
    environmentIntensity: 1,
});

/**
 * Synchronously renders a small linear-RGBA CPU reference image.
 *
 * This deliberately uses the worker integrator's exact camera jitter and seed
 * contract. It is intended for deterministic release checks, not interactive
 * presentation; callers should keep dimensions and sample counts small.
 */
export function renderCpuReference({
    scene,
    cameraFrame,
    width,
    height,
    acceleration,
    settings: partialSettings = {},
} = {}) {
    if (!scene || !cameraFrame) throw new Error('CPU reference rendering requires a scene and camera frame.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error('CPU reference dimensions must be positive integers.');
    }
    const settings = { ...DEFAULT_REFERENCE_SETTINGS, ...partialSettings };
    if (!Number.isInteger(settings.spp) || settings.spp < 1) {
        throw new Error('CPU reference spp must be a positive integer.');
    }
    const structures = acceleration || buildAccelerationStructures(scene);
    const data = new Float32Array(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const outputOffset = (y * width + x) * 4;
            for (let sampleIndex = 0; sampleIndex < settings.spp; sampleIndex += 1) {
                const rng = createRng(pixelSampleSeed(settings.seed, x, y, sampleIndex));
                const ray = generateCameraRay(
                    cameraFrame, x, y, width, height, [nextFloat(rng), nextFloat(rng)],
                );
                const color = traceSample(ray, scene, structures, rng, settings);
                for (let channel = 0; channel < 3; channel += 1) {
                    data[outputOffset + channel] += color[channel] / settings.spp;
                }
            }
            data[outputOffset + 3] = 1;
        }
    }
    return { width, height, spp: settings.spp, data };
}
