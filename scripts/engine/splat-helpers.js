/**
 * @file GPU resource helpers for the Gaussian-splatting renderer.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * `packSplats` is pure (no GPU) and, with ply-loader.js, forms the data boundary
 * a future WASM module can replace. The create* helpers build the WebGPU buffers
 * and pipelines used by SplatRenderer.
 */

import { SH_REST_PER_CHANNEL } from './ply-loader.js';

// Floats per splat in the packed storage layout (64 bytes, std-friendly).
//   [0..2] position xyz, [3] pad
//   [4..6] color rgb,    [7] opacity
//   [8..10] cov σxx,σxy,σxz, [11] pad
//   [12..14] cov σyy,σyz,σzz, [15] pad
export const SPLAT_FLOATS = 16;
export const SPLAT_STRIDE = SPLAT_FLOATS * 4; // bytes

// Non-DC SH lives in its own storage buffer, kept out of the 64-byte splat struct
// above so the depth sort (which only reads position) stays cache-friendly.
// Laid out as flat f32 — NOT array<vec3<f32>>, whose 16-byte alignment would
// waste 4 bytes per coefficient.

/** Non-DC SH coefficients per splat at a given degree (deg 3 = 15). */
export function shCoeffCount(degree) {
    return SH_REST_PER_CHANNEL[degree] ?? 0;
}

/** Bytes of non-DC SH per splat at a given degree (deg 3 = 15 coeffs x rgb x 4B = 180B). */
export function shBytesPerSplat(degree) {
    return shCoeffCount(degree) * 3 * 4;
}

/**
 * Highest SH degree whose buffer fits within the device's storage-binding limit.
 * Degree 3 at 180 B/splat exceeds the default 128 MB limit past ~745k splats, so
 * large scenes silently degrade rather than failing to load.
 *
 * @param {number} requestedDegree Degree actually present in the file.
 * @param {number} count Splat count.
 * @param {number} maxBindingSize `device.limits.maxStorageBufferBindingSize`.
 * @returns {number} Degree to use (<= requestedDegree).
 */
export function fitShDegree(requestedDegree, count, maxBindingSize) {
    let degree = requestedDegree;
    while (degree > 0 && count * shBytesPerSplat(degree) > maxBindingSize) {
        degree--;
    }
    return degree;
}

/**
 * Truncates coefficient-major SH data from `sourceDegree` down to `targetDegree`.
 * Returns the input untouched when the degrees already match.
 */
export function packShCoeffs(shCoeffs, count, sourceDegree, targetDegree) {
    if (!shCoeffs || targetDegree <= 0) return null;
    if (targetDegree === sourceDegree) return shCoeffs;

    const srcStride = SH_REST_PER_CHANNEL[sourceDegree] * 3;
    const dstStride = SH_REST_PER_CHANNEL[targetDegree] * 3;
    const out = new Float32Array(count * dstStride);
    for (let i = 0; i < count; i++) {
        // Lower degrees are a prefix of higher ones, so a straight copy suffices.
        out.set(shCoeffs.subarray(i * srcStride, i * srcStride + dstStride), i * dstStride);
    }
    return out;
}

/**
 * Storage buffer holding non-DC SH coefficients, read by the splat vertex shader.
 * When a scene has no usable SH a 16-byte placeholder is returned: the WGSL
 * binding always exists, and the shader guards on `shDegree == 0` before reading.
 */
export function createShStorageBuffer(device, shCoeffs) {
    const data = shCoeffs && shCoeffs.length > 0 ? shCoeffs : new Float32Array(4);
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

/** Smallest power of two >= n (>=1). Used to pad the sort arrays for bitonic sort. */
export function nextPow2(n) {
    if (n <= 1) return 1;
    return 1 << Math.ceil(Math.log2(n));
}

/** Row-major 3x3 rotation matrix from a (w,x,y,z) quaternion (assumed normalized). */
function quatToMat3(w, x, y, z) {
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y),
        2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
        2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y),
    ];
}

/**
 * Packs parsed splats into a single interleaved Float32Array.
 * The 3D covariance Σ = R·S·Sᵀ·Rᵀ is precomputed here (upper triangle) so the
 * vertex shader only has to project it.
 * @param {{positions:Float32Array,colors:Float32Array,opacities:Float32Array,scales:Float32Array,rotations:Float32Array,count:number}} parsed
 * @returns {Float32Array}
 */
export function packSplats(parsed) {
    const { positions, colors, opacities, scales, rotations, count } = parsed;
    const out = new Float32Array(count * SPLAT_FLOATS);

    for (let i = 0; i < count; i++) {
        const o = i * SPLAT_FLOATS;

        out[o + 0] = positions[i * 3 + 0];
        out[o + 1] = positions[i * 3 + 1];
        out[o + 2] = positions[i * 3 + 2];

        out[o + 4] = colors[i * 3 + 0];
        out[o + 5] = colors[i * 3 + 1];
        out[o + 6] = colors[i * 3 + 2];
        out[o + 7] = opacities[i];

        const R = quatToMat3(
            rotations[i * 4 + 0], rotations[i * 4 + 1],
            rotations[i * 4 + 2], rotations[i * 4 + 3],
        );
        const sx2 = scales[i * 3 + 0] ** 2;
        const sy2 = scales[i * 3 + 1] ** 2;
        const sz2 = scales[i * 3 + 2] ** 2;

        // Σ[i][k] = Σ_j R[i][j]·R[k][j]·s[j]²  (R row-major: R[r*3+c])
        const cov = (a, b) =>
            R[a * 3 + 0] * R[b * 3 + 0] * sx2 +
            R[a * 3 + 1] * R[b * 3 + 1] * sy2 +
            R[a * 3 + 2] * R[b * 3 + 2] * sz2;

        out[o + 8]  = cov(0, 0); // σxx
        out[o + 9]  = cov(0, 1); // σxy
        out[o + 10] = cov(0, 2); // σxz
        out[o + 12] = cov(1, 1); // σyy
        out[o + 13] = cov(1, 2); // σyz
        out[o + 14] = cov(2, 2); // σzz
    }

    return out;
}

/** Storage buffer holding the packed splats (read by the vertex + compute shaders). */
export function createSplatStorageBuffer(device, packed) {
    const buffer = device.createBuffer({
        size: packed.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, packed);
    return buffer;
}

/**
 * Index + depth-key buffers for the bitonic sort, padded to a power of two.
 * @returns {{ indexBuffer: GPUBuffer, keyBuffer: GPUBuffer, paddedCount: number }}
 */
export function createSortBuffers(device, count) {
    const paddedCount = nextPow2(count);
    const indexBuffer = device.createBuffer({
        size: paddedCount * 4, // u32 per entry
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const keyBuffer = device.createBuffer({
        size: paddedCount * 4, // f32 depth key per entry
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    return { indexBuffer, keyBuffer, paddedCount };
}

/**
 * Render pipeline for full Gaussian splatting: instanced triangle-strip quads
 * with premultiplied alpha-over blending and no depth.
 */
export function createSplatRenderPipeline(device, wgslSource, format) {
    const module = device.createShaderModule({ code: wgslSource });
    const blend = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-strip' },
    });
}

/** Debug pipeline: draws splat centers as points (no blend, no depth). */
export function createSplatDebugPipeline(device, wgslSource, format) {
    const module = device.createShaderModule({ code: wgslSource });
    return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_debug_points' },
        fragment: { module, entryPoint: 'fs_debug_points', targets: [{ format }] },
        primitive: { topology: 'point-list' },
    });
}

/**
 * Compute pipelines for the depth sort.
 * @returns {{ keys: GPUComputePipeline, step: GPUComputePipeline }}
 */
export function createSortPipelines(device, wgslSource) {
    const module = device.createShaderModule({ code: wgslSource });
    return {
        keys: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'compute_keys' } }),
        step: device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'bitonic_step' } }),
    };
}
