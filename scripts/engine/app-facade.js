/**
 * @file Engine entry point — routes to the WebGL or WebGPU backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { initWebGLEngine } from './webgl-facade.js';
import { initWebGPUEngine } from './webgpu-facade.js';

/**
 * Initialises the rendering engine for the given backend.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {'webgl'|'webgpu'} [opts.backend='webgl']
 * @param {object} opts.shaderSources
 *   - WebGL:  { vertex: string, fragment: string }
 *   - WebGPU: { wgsl: string }
 * @param {string} opts.scriptSource
 * @param {Function} [opts.onError]
 */
export async function initEngine({ canvas, backend = 'webgl', shaderSources, scriptSource, onError }) {
    if (backend === 'webgpu') {
        return initWebGPUEngine({ canvas, shaderSources, scriptSource, onError });
    }
    return initWebGLEngine({ canvas, shaderSources, scriptSource, onError });
}
