/**
 * @file WebGPU engine facade — mirrors the public API of webgl-facade.js.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { Camera } from './camera.js';
import { compileUserScript } from './script-runtime.js';
import { generateCubeData, generateSphereData, resolveTextureUrl } from './geometry.js';
import { initWebGPU, createRenderPipeline, createVertexBuffer, createIndexBuffer, createTextureFromUrl, createTextureFromImageBitmap } from './webgpu-helpers.js';
import {
    createSplatStorageBuffer,
    createShStorageBuffer,
    packShCoeffs,
    fitShDegree,
} from './splat-helpers.js';
import { createWebGPUScene } from './webgpu-scene.js';

export function buildDrawableFromData(device, data, texture = null, name = 'drawable') {
    return {
        buffers: {
            position: createVertexBuffer(device, data.positions),
            normal:   createVertexBuffer(device, data.normals),
            texCoord: createVertexBuffer(device, data.texCoords),
            indices:  createIndexBuffer(device, data.indices),
        },
        kind: 'mesh',
        texture,
        vertexCount: data.vertexCount,
        indexFormat: data.indexFormat ?? 'uint16',
        _debug: { name },
    };
}

/**
 * Returns a backend-agnostic shape factory for WebGPU.
 * Mirrors the shape creation surface used by the UI layer.
 */
export function createWebGPUGeometryFactory(device, textureUrl) {
    async function loadTexture() {
        if (!textureUrl) {
            const { baseUrl } = resolveTextureUrl();
            textureUrl = baseUrl;
        }
        return createTextureFromUrl(device, textureUrl);
    }

    return {
        createCube() {
            return buildDrawableFromData(device, generateCubeData(), null, 'cube');
        },
        async createTexturedCube() {
            try {
                const texture = await loadTexture();
                return buildDrawableFromData(device, generateCubeData(), texture, 'textured cube');
            } catch (e) {
                console.error('Failed to load texture, falling back to untextured cube:', e);
                return buildDrawableFromData(device, generateCubeData(), null, 'cube');
            }
        },
        createSphere() {
            return buildDrawableFromData(device, generateSphereData(), null, 'sphere');
        },
        async createTexturedSphere() {
            try {
                const texture = await loadTexture();
                return buildDrawableFromData(device, generateSphereData(), texture, 'textured sphere');
            } catch (e) {
                console.error('Failed to load texture, falling back to untextured sphere:', e);
                return buildDrawableFromData(device, generateSphereData(), null, 'sphere');
            }
        },
    };
}

export async function initWebGPUEngine({ canvas, shaderSources, scriptSource, onError }) {
    const errorHandler = onError || ((err) => console.error(err));

    if (!canvas) {
        errorHandler(new Error('No canvas element provided.'));
        return null;
    }

    let gpuContext;
    try {
        gpuContext = await initWebGPU(canvas);
    } catch (e) {
        errorHandler(e);
        return null;
    }

    const { device, context, format } = gpuContext;
    const camera = new Camera(canvas, [0, 0, 5]);
    const scene  = createWebGPUScene(device, context, format, canvas, camera);

    // Load default cube geometry
    const cubeData = generateCubeData();
    scene.loadGeometry(buildDrawableFromData(device, cubeData));

    function setShaders(wgslSource) {
        if (!wgslSource) return false;
        try {
            const pipeline = createRenderPipeline(device, wgslSource, format);
            scene.updatePipeline(pipeline);
            return true;
        } catch (e) {
            errorHandler(e);
            return false;
        }
    }

    function setScriptSource(source) {
        if (!source) return false;
        try {
            scene.updateUserScript(compileUserScript(source, { camera }));
            return true;
        } catch (e) {
            errorHandler(e);
            return false;
        }
    }

    /**
     * Parses a 3DGS .ply ArrayBuffer and loads it as a splat drawable.
     *
     * View-dependent colour uses whatever SH degree the file provides, capped to
     * what fits the device's storage-binding limit — degree 3 costs 180 B/splat,
     * so very large scenes degrade to a lower degree instead of failing to load.
     *
     * @param {ArrayBuffer} arrayBuffer
     * @returns {{ kind: 'splat', storageBuffer: GPUBuffer, shBuffer: GPUBuffer,
     *            shDegree: number, count: number, bounds: object|null }}
     */
    // Off-main-thread parse/mirror/pack. The client owns a Worker (with a
    // synchronous fallback) that retains the parsed cloud, so both the initial
    // load and the live Y-flip toggle re-pack without blocking the main thread.
    // Lazily imported so the `import.meta`-bearing worker module never enters
    // Jest's babel graph (cf. geometry.js's `new Function` dodge).
    let splatLoader = null;
    async function getSplatLoader() {
        if (!splatLoader) {
            const mod = await import('./splat-loader-client.js');
            splatLoader = mod.createSplatLoaderClient();
        }
        return splatLoader;
    }

    // Build the GPU-side splat drawable from a worker payload. GPU buffer
    // creation must stay on the main thread (no device inside the worker), and
    // the SH degree can only be fitted here since it depends on device limits.
    function buildSplatDrawable(payload) {
        // Checked before allocating: unlike the SH buffer (which fitShDegree
        // degrades), an oversized splat buffer used to reach createBuffer and fail
        // as a bare WebGPU validation error with nothing actionable in it.
        //
        // Both limits bind. A storage buffer must fit maxStorageBufferBindingSize
        // *and* maxBufferSize, and their defaults differ (128 MiB vs 256 MiB), so
        // checking only the binding size lets an allocation past this guard fail
        // later on the other one.
        const maxBinding = device.limits.maxStorageBufferBindingSize;
        const maxBuffer = device.limits.maxBufferSize;
        const maxSplatBytes = Math.min(maxBinding, maxBuffer);
        if (payload.packed.byteLength > maxSplatBytes) {
            const mib = (bytes) => Math.round(bytes / 1048576);
            throw new Error(
                `Splat cloud too large for this device: ${payload.count.toLocaleString()} splats ` +
                `need ${mib(payload.packed.byteLength)} MiB, but this device allows ` +
                `${mib(maxSplatBytes)} MiB (maxStorageBufferBindingSize ${mib(maxBinding)} MiB, ` +
                `maxBufferSize ${mib(maxBuffer)} MiB). Load a smaller capture.`,
            );
        }
        const storageBuffer = createSplatStorageBuffer(device, payload.packed);

        const shDegree = fitShDegree(
            payload.shDegree,
            payload.count,
            device.limits.maxStorageBufferBindingSize,
        );
        if (shDegree < payload.shDegree) {
            console.warn(
                `Splat SH degree reduced ${payload.shDegree} -> ${shDegree} to fit ` +
                `maxStorageBufferBindingSize (${device.limits.maxStorageBufferBindingSize} bytes).`,
            );
        }
        const shBuffer = createShStorageBuffer(
            device,
            packShCoeffs(payload.shCoeffs, payload.count, payload.shDegree, shDegree),
        );

        const drawable = {
            kind: 'splat',
            storageBuffer,
            shBuffer,
            shDegree,
            count: payload.count,
            bounds: payload.bounds,
            // Cloud is normalized to origin/radius-1 at load; this maps back to
            // the capture's original world frame (see normalizeInPlace).
            sourceTransform: payload.sourceTransform ?? null,
            positions: payload.positions, // world-space centers, for the Culled reduction's grid
            _debug: { name: 'splat cloud' },
        };
        scene.loadGeometry(drawable); // releases the previous drawable's GPU buffers
        return drawable;
    }

    /**
     * Parses and loads a 3DGS `.ply` (parsing runs in a Web Worker).
     * @param {ArrayBuffer} arrayBuffer
     * @param {{ flipY?: boolean }} [opts] flipY reflects the scene about the XZ
     *        plane (default true — most captures are stored y-down).
     * @returns {Promise<object>} the loaded splat drawable.
     */
    async function loadSplats(arrayBuffer, { flipY = true } = {}) {
        const loader = await getSplatLoader();
        const payload = await loader.load(arrayBuffer, flipY);
        return buildSplatDrawable(payload);
    }

    /** Toggle the Y-flip on the loaded splat cloud, re-packing GPU buffers off-thread. */
    async function setSplatFlipY(flipY) {
        const loader = await getSplatLoader();
        const payload = await loader.setFlip(flipY);
        if (!payload) return null;
        return buildSplatDrawable(payload);
    }

    /**
     * Loads a parsed triangle mesh (see mesh-ply-loader.js) as a textured drawable.
     * @param {{ meshData: object, textureBitmap?: ImageBitmap|null }} args
     */
    function loadMesh({ meshData, textureBitmap = null }) {
        const texture = textureBitmap ? createTextureFromImageBitmap(device, textureBitmap) : null;
        const drawable = buildDrawableFromData(device, meshData, texture, meshData.name || 'mesh');
        drawable.bounds = meshData.bounds;
        scene.loadGeometry(drawable);
        return drawable;
    }

    function setSplatDebugMode(mode) {
        scene.setSplatDebugMode(mode);
    }

    /** Clamp the SH degree used for splat shading (0 = flat DC colour). */
    function setSplatShDegree(degree) {
        scene.setSplatShDegree(degree);
    }

    /** Set the splat render mode: 'instanced' or 'tile'. */
    function setSplatRenderMode(mode) {
        scene.setSplatRenderMode(mode);
    }

    /** Set the ordering reduction axis: 'none' or 'culled'. */
    function setSplatReduction(mode) {
        scene.setSplatReduction(mode);
    }

    /** Set the ordering sort axis: 'bitonic' or 'radix'. */
    function setSplatSort(mode) {
        scene.setSplatSort(mode);
    }

    if (!shaderSources?.wgsl) {
        errorHandler(new Error('Missing WGSL shader source.'));
        return null;
    }

    setShaders(shaderSources.wgsl);
    if (shaderSources.splatWgsl && shaderSources.splatSortWgsl) {
        scene.setSplatShaders(
            shaderSources.splatWgsl,
            shaderSources.splatSortWgsl,
            shaderSources.splatCullWgsl,
            shaderSources.splatRadixWgsl,
        );
    }
    if (shaderSources.blitWgsl && shaderSources.tileRenderWgsl) {
        scene.setTileShaders(shaderSources.blitWgsl, shaderSources.tileRenderWgsl);
    }
    setScriptSource(scriptSource);
    scene.start();

    return {
        device, scene, camera,
        setShaders, setScriptSource,
        loadSplats, setSplatFlipY, loadMesh, setSplatDebugMode, setSplatShDegree, setSplatRenderMode, setSplatReduction, setSplatSort,
        // Benchmark hook: true end-to-end GPU frame cost, for when fps and
        // timestamp spans can't be trusted (see webgpu-scene.measureFrameCost).
        measureFrameCost: (opts) => scene.measureFrameCost(opts),
        getStats: () => scene.getStats(),
        destroy: () => {
            if (splatLoader) splatLoader.destroy();
            scene.destroy();
        },
    };
}
