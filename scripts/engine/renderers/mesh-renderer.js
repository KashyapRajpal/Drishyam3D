/**
 * @file MeshRenderer — opaque indexed-triangle path for the WebGPU backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Owns the triangle-specific GPU resources only (render pipeline, matrix +
 * material uniform buffers, sampler, default texture, depth texture, bind
 * group). Shared entities (camera, view/projection matrices, the user-script
 * model matrix) arrive via the `frame` passed to record().
 */
import { Renderer } from './renderer.js';
import { createIdentityMatrix, multiplyMatrices } from '../matrix.js';
import {
    MATRIX_UNIFORM_SIZE,
    MATERIAL_UNIFORM_SIZE,
    createUniformBuffer,
    createDefaultTexture,
    createSampler,
    createDepthTexture,
    createBindGroup,
} from '../webgpu-helpers.js';

export class MeshRenderer extends Renderer {
    get kind() { return 'mesh'; }

    constructor(device, format) {
        super(device, format);
        this.pipeline = null;
        this.matrixBuffer = null;
        this.materialBuffer = null;
        this.sampler = null;
        this.defaultTexture = null;
        this.depthTexture = null;
        this.depthWidth = 0;
        this.depthHeight = 0;
        this.bindGroup = null;
        // Scratch ArrayBuffers reused every frame to avoid per-frame allocations
        this.matrixData = new Float32Array(32);   // 2x mat4 = 32 floats
        this.materialData = new Float32Array(8);  // vec4 + u32 + pad = 8 floats
    }

    init() {
        this.matrixBuffer = createUniformBuffer(this.device, MATRIX_UNIFORM_SIZE);
        this.materialBuffer = createUniformBuffer(this.device, MATERIAL_UNIFORM_SIZE);
        this.sampler = createSampler(this.device);
        this.defaultTexture = createDefaultTexture(this.device);
    }

    /** Set the render pipeline (built by the facade from WGSL); rebuild bind group lazily. */
    setPipeline(pipeline) {
        this.pipeline = pipeline;
        this.bindGroup = null;
    }

    prepare(_drawable) {
        // Texture may differ for the new drawable — force a bind-group rebuild.
        this.bindGroup = null;
    }

    _ensureDepthTexture(width, height) {
        if (this.depthTexture && this.depthWidth === width && this.depthHeight === height) return;
        if (this.depthTexture) this.depthTexture.destroy();
        this.depthTexture = createDepthTexture(this.device, width, height);
        this.depthWidth = width;
        this.depthHeight = height;
    }

    record(frame, drawable) {
        const { device, encoder, targetView, viewMatrix, projectionMatrix, width, height, sceneState } = frame;
        if (!this.pipeline || !drawable) return;

        this._ensureDepthTexture(width, height);

        // The user script mutates sceneState.modelViewMatrix as the model matrix.
        const modelMatrix = sceneState.modelViewMatrix || createIdentityMatrix();
        const modelViewMatrix = multiplyMatrices(viewMatrix, modelMatrix);

        // Upload matrices
        this.matrixData.set(projectionMatrix, 0);
        this.matrixData.set(modelViewMatrix, 16);
        device.queue.writeBuffer(this.matrixBuffer, 0, this.matrixData);

        // Upload material — hasTexture written as u32 at byte offset 16
        const hasTexture = drawable.texture ? 1 : 0;
        const baseColor = hasTexture ? [1, 1, 1, 1] : [0.5, 0.5, 1.0, 1.0];
        this.materialData[0] = baseColor[0];
        this.materialData[1] = baseColor[1];
        this.materialData[2] = baseColor[2];
        this.materialData[3] = baseColor[3];
        new Uint32Array(this.materialData.buffer)[4] = hasTexture;
        device.queue.writeBuffer(this.materialBuffer, 0, this.materialData);

        // Rebuild bind group only when the drawable's texture changes
        const expectedTexture = drawable.texture ?? this.defaultTexture;
        if (!this.bindGroup || this.bindGroup._texture !== expectedTexture) {
            this.bindGroup = createBindGroup(device, this.pipeline, {
                matrixBuffer: this.matrixBuffer,
                materialBuffer: this.materialBuffer,
                sampler: this.sampler,
                texture: expectedTexture,
            });
            this.bindGroup._texture = expectedTexture;
        }

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, drawable.buffers.position);
        pass.setVertexBuffer(1, drawable.buffers.normal);
        pass.setVertexBuffer(2, drawable.buffers.texCoord);
        pass.setIndexBuffer(drawable.buffers.indices, 'uint16');
        pass.drawIndexed(drawable.vertexCount);
        pass.end();
    }

    releaseDrawable(drawable) {
        if (!drawable || !drawable.buffers) return;
        const { buffers, texture } = drawable;
        if (buffers.position?.destroy) buffers.position.destroy();
        if (buffers.normal?.destroy) buffers.normal.destroy();
        if (buffers.texCoord?.destroy) buffers.texCoord.destroy();
        if (buffers.indices?.destroy) buffers.indices.destroy();
        // Never destroy the shared default texture.
        if (texture && texture !== this.defaultTexture && texture.destroy) {
            texture.destroy();
        }
    }

    destroy() {
        if (this.depthTexture?.destroy) this.depthTexture.destroy();
        if (this.matrixBuffer?.destroy) this.matrixBuffer.destroy();
        if (this.materialBuffer?.destroy) this.materialBuffer.destroy();
        if (this.defaultTexture?.destroy) this.defaultTexture.destroy();
    }
}
