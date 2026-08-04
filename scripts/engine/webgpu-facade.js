/**
 * @file WebGPU engine facade — mirrors the public API of webgl-facade.js.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { Camera } from './camera.js';
import { compileUserScript } from './script-runtime.js';
import { generateCubeData, generateSphereData, resolveTextureUrl } from './geometry.js';
import { initWebGPU, createRenderPipeline, createVertexBuffer, createIndexBuffer, createTextureFromUrl, createTextureFromImageBitmap } from './webgpu-helpers.js';
import { parsePly, mirrorYInPlace } from './ply-loader.js';
import {
    packSplats,
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
    // Cached parsed cloud + whether it is currently mirrored, so the Y-flip can be
    // toggled live without re-parsing the file. mirrorYInPlace is its own inverse.
    let splatData = null;
    let splatFlipped = false;

    function packAndLoadSplat() {
        const packed = packSplats(splatData);
        const storageBuffer = createSplatStorageBuffer(device, packed);

        const shDegree = fitShDegree(
            splatData.shDegree,
            splatData.count,
            device.limits.maxStorageBufferBindingSize,
        );
        if (shDegree < splatData.shDegree) {
            console.warn(
                `Splat SH degree reduced ${splatData.shDegree} -> ${shDegree} to fit ` +
                `maxStorageBufferBindingSize (${device.limits.maxStorageBufferBindingSize} bytes).`,
            );
        }
        const shBuffer = createShStorageBuffer(
            device,
            packShCoeffs(splatData.shCoeffs, splatData.count, splatData.shDegree, shDegree),
        );

        const drawable = {
            kind: 'splat',
            storageBuffer,
            shBuffer,
            shDegree,
            count: splatData.count,
            bounds: splatData.bounds,
            positions: splatData.positions, // world-space centers, for the Culled reduction's grid
            _debug: { name: 'splat cloud' },
        };
        scene.loadGeometry(drawable); // releases the previous drawable's GPU buffers
        return drawable;
    }

    /**
     * Parses and loads a 3DGS `.ply`.
     * @param {ArrayBuffer} arrayBuffer
     * @param {{ flipY?: boolean }} [opts] flipY reflects the scene about the XZ
     *        plane (default true — most captures are stored y-down).
     */
    function loadSplats(arrayBuffer, { flipY = true } = {}) {
        splatData = parsePly(arrayBuffer);
        splatFlipped = false;
        if (flipY) {
            mirrorYInPlace(splatData);
            splatFlipped = true;
        }
        return packAndLoadSplat();
    }

    /** Toggle the Y-flip on the loaded splat cloud in place, re-packing GPU buffers. */
    function setSplatFlipY(flipY) {
        const want = !!flipY;
        if (!splatData || want === splatFlipped) return null;
        mirrorYInPlace(splatData);
        splatFlipped = want;
        return packAndLoadSplat();
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

    if (!shaderSources?.wgsl) {
        errorHandler(new Error('Missing WGSL shader source.'));
        return null;
    }

    setShaders(shaderSources.wgsl);
    if (shaderSources.splatWgsl && shaderSources.splatSortWgsl) {
        scene.setSplatShaders(shaderSources.splatWgsl, shaderSources.splatSortWgsl, shaderSources.splatCullWgsl);
    }
    if (shaderSources.blitWgsl && shaderSources.tileRenderWgsl) {
        scene.setTileShaders(shaderSources.blitWgsl, shaderSources.tileRenderWgsl);
    }
    setScriptSource(scriptSource);
    scene.start();

    return {
        device, scene, camera,
        setShaders, setScriptSource,
        loadSplats, setSplatFlipY, loadMesh, setSplatDebugMode, setSplatShDegree, setSplatRenderMode, setSplatReduction,
        getStats: () => scene.getStats(),
        destroy: () => scene.destroy(),
    };
}
