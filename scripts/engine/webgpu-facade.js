/**
 * @file WebGPU engine facade — mirrors the public API of webgl-facade.js.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { translateMatrix, rotateMatrix } from './matrix.js';
import { Camera } from './camera.js';
import { generateCubeData, generateSphereData, resolveTextureUrl } from './geometry.js';
import { initWebGPU, createRenderPipeline, createVertexBuffer, createIndexBuffer, createTextureFromUrl } from './webgpu-helpers.js';
import { createWebGPUScene } from './webgpu-scene.js';

export function buildDrawableFromData(device, data, texture = null, name = 'drawable') {
    return {
        buffers: {
            position: createVertexBuffer(device, data.positions),
            normal:   createVertexBuffer(device, data.normals),
            texCoord: createVertexBuffer(device, data.texCoords),
            indices:  createIndexBuffer(device, data.indices),
        },
        texture,
        vertexCount: data.vertexCount,
        _debug: { name },
    };
}

/**
 * Returns a backend-agnostic shape factory for WebGPU.
 * Mirrors the shape creation surface used by menu-handlers.
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
            const scriptModule = new Function('translateMatrix', 'rotateMatrix', 'camera',
                `${source}\n return { init, update };`
            )(translateMatrix, rotateMatrix, camera);

            if (scriptModule && typeof scriptModule.init === 'function' && typeof scriptModule.update === 'function') {
                scene.updateUserScript(scriptModule);
                return true;
            }
            throw new Error("Script must export 'init' and 'update' functions.");
        } catch (e) {
            errorHandler(e);
            return false;
        }
    }

    if (!shaderSources?.wgsl) {
        errorHandler(new Error('Missing WGSL shader source.'));
        return null;
    }

    setShaders(shaderSources.wgsl);
    setScriptSource(scriptSource);
    scene.start();

    return { device, scene, camera, setShaders, setScriptSource, destroy: () => scene.destroy() };
}
