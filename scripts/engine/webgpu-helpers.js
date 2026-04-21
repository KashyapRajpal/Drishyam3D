/**
 * @file WebGPU initialization and resource creation utilities.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

// Uniform buffer sizes (must match the WGSL struct layouts in default.wgsl)
// Uniforms: projectionMatrix (64) + modelViewMatrix (64) = 128 bytes
export const MATRIX_UNIFORM_SIZE = 128;
// Material: baseColor vec4 (16) + hasTexture u32 (4) + 3x padding u32 (12) = 32 bytes
export const MATERIAL_UNIFORM_SIZE = 32;

/**
 * Requests a WebGPU adapter and device, then configures the canvas context.
 * Throws if WebGPU is unavailable in the browser.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat}>}
 */
export async function initWebGPU(canvas) {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('No WebGPU adapter found.');
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({ device, format, alphaMode: 'premultiplied' });

    return { device, context, format };
}

/**
 * Creates a GPURenderPipeline from WGSL source.
 * Expects 3 separate vertex buffers at slots 0/1/2: position, normal, texcoord.
 * @param {GPUDevice} device
 * @param {string} wgslSource
 * @param {GPUTextureFormat} format - Canvas swap-chain format
 * @returns {GPURenderPipeline}
 */
export function createRenderPipeline(device, wgslSource, format) {
    const shaderModule = device.createShaderModule({ code: wgslSource });

    return device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [
                // slot 0: position (vec3<f32>)
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                // slot 1: normal (vec3<f32>)
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                // slot 2: texcoord (vec2<f32>)
                { arrayStride: 8,  attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ],
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format }],
        },
        primitive: {
            topology: 'triangle-list',
            cullMode: 'back',
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });
}

/**
 * Creates a GPU vertex buffer and uploads data.
 * @param {GPUDevice} device
 * @param {Float32Array} data
 * @returns {GPUBuffer}
 */
export function createVertexBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

/**
 * Creates a GPU index buffer and uploads data.
 * @param {GPUDevice} device
 * @param {Uint16Array} data
 * @returns {GPUBuffer}
 */
export function createIndexBuffer(device, data) {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

/**
 * Creates an empty uniform buffer of the given byte size.
 * @param {GPUDevice} device
 * @param {number} size - Byte size (must be a multiple of 4)
 * @returns {GPUBuffer}
 */
export function createUniformBuffer(device, size) {
    return device.createBuffer({
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

/**
 * Creates a 1x1 opaque white texture as a fallback for untextured drawables.
 * @param {GPUDevice} device
 * @returns {GPUTexture}
 */
export function createDefaultTexture(device) {
    const texture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
        { texture },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
    );
    return texture;
}

/**
 * Creates a GPUSampler with linear filtering and clamp-to-edge addressing.
 * @param {GPUDevice} device
 * @returns {GPUSampler}
 */
export function createSampler(device) {
    return device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });
}

/**
 * Creates a depth texture for the render pass.
 * Must be recreated whenever the canvas is resized.
 * @param {GPUDevice} device
 * @param {number} width
 * @param {number} height
 * @returns {GPUTexture}
 */
export function createDepthTexture(device, width, height) {
    return device.createTexture({
        size: [width, height, 1],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

/**
 * Loads an image from a URL and uploads it as a GPUTexture.
 * @param {GPUDevice} device
 * @param {string} url
 * @returns {Promise<GPUTexture>}
 */
export async function createTextureFromUrl(device, url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch texture from '${url}': ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    return createTextureFromImageBitmap(device, imageBitmap);
}

/**
 * Uploads an ImageBitmap into a GPU texture.
 * @param {GPUDevice} device
 * @param {ImageBitmap} imageBitmap
 * @returns {GPUTexture}
 */
export function createTextureFromImageBitmap(device, imageBitmap) {
    const texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture },
        [imageBitmap.width, imageBitmap.height],
    );
    return texture;
}

/**
 * Creates a bind group for the default pipeline (group 0).
 * Bindings: (0) matrix UB, (1) material UB, (2) sampler, (3) texture view.
 * @param {GPUDevice} device
 * @param {GPURenderPipeline} pipeline
 * @param {object} resources
 * @param {GPUBuffer} resources.matrixBuffer
 * @param {GPUBuffer} resources.materialBuffer
 * @param {GPUSampler} resources.sampler
 * @param {GPUTexture} resources.texture
 * @returns {GPUBindGroup}
 */
export function createBindGroup(device, pipeline, { matrixBuffer, materialBuffer, sampler, texture }) {
    return device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: matrixBuffer } },
            { binding: 1, resource: { buffer: materialBuffer } },
            { binding: 2, resource: sampler },
            { binding: 3, resource: texture.createView() },
        ],
    });
}
