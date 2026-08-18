import { Renderer } from './renderer.js';
import { getMeshPrimitives } from './mesh-renderer.js';
import { createIdentityMatrix, invertMatrix, multiplyMatrices } from '../matrix.js';
import {
    createDefaultTexture,
    createSampler,
    createUniformBuffer,
} from '../webgpu-helpers.js';
import {
    HYBRID_GBUFFER_FORMATS,
    createHybridGBuffer,
    createHybridVisibilityFallback,
    destroyHybridGBuffer,
} from '../raytracing/hybrid/gbuffer-layout.js';

export const HYBRID_FRAME_UNIFORM_SIZE = 256;
export const HYBRID_LIGHT_UNIFORM_SIZE = 64;
const HYBRID_MATERIAL_UNIFORM_SIZE = 32;
const LIGHT_TYPE = Object.freeze({ directional: 0, point: 1 });
const DEFAULT_LIGHT = Object.freeze({
    type: 'directional',
    direction: [-0.5, -1, -0.3],
    color: [1, 1, 1],
    intensity: 1,
    ambient: 0.2,
    exposure: 1,
});

function destroy(resource) {
    resource?.destroy?.();
}

function validateVector(value, label) {
    if (!value || value.length !== 3 || !value.every(Number.isFinite)) {
        throw new Error(`${label} must contain three finite values.`);
    }
}

export class HybridShadowRenderer extends Renderer {
    get kind() { return 'mesh'; }

    constructor(device, format) {
        super(device, format);
        this.layouts = null;
        this.gbufferPipeline = null;
        this.compositePipeline = null;
        this.gbuffer = null;
        this.visibilityFallback = null;
        this.defaultTexture = null;
        this.sampler = null;
        this.lightBuffer = null;
        this.compositeBindGroup = null;
        this.drawableStates = new WeakMap();
        this.liveStates = new Set();
        this.light = { ...DEFAULT_LIGHT, direction: [...DEFAULT_LIGHT.direction], color: [...DEFAULT_LIGHT.color] };
        this.initialized = false;
        this.destroyed = false;
        this.drawable = null;
    }

    init() {
        if (this.initialized) return;
        if (this.destroyed) throw new Error('Cannot initialize a destroyed hybrid renderer.');
        const frame = this.device.createBindGroupLayout({
            label: 'Hybrid G-buffer frame layout',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform', minBindingSize: HYBRID_FRAME_UNIFORM_SIZE },
            }],
        });
        const material = this.device.createBindGroupLayout({
            label: 'Hybrid G-buffer material layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: HYBRID_MATERIAL_UNIFORM_SIZE } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ],
        });
        const composite = this.device.createBindGroupLayout({
            label: 'Hybrid composite layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: HYBRID_LIGHT_UNIFORM_SIZE } },
            ],
        });
        this.layouts = {
            frame,
            material,
            composite,
            gbufferPipeline: this.device.createPipelineLayout({ bindGroupLayouts: [frame, material] }),
            compositePipeline: this.device.createPipelineLayout({ bindGroupLayouts: [composite] }),
        };
        this.sampler = createSampler(this.device);
        this.defaultTexture = createDefaultTexture(this.device);
        this.visibilityFallback = createHybridVisibilityFallback(this.device);
        this.lightBuffer = createUniformBuffer(this.device, HYBRID_LIGHT_UNIFORM_SIZE);
        this.initialized = true;
    }

    setShaders(gbufferSource, compositeSource) {
        if (!gbufferSource || !compositeSource) throw new Error('Hybrid rendering requires G-buffer and composite WGSL.');
        if (!this.initialized) this.init();
        const gbufferModule = this.device.createShaderModule({ label: 'Hybrid G-buffer shader', code: gbufferSource });
        const compositeModule = this.device.createShaderModule({ label: 'Hybrid composite shader', code: compositeSource });
        this.gbufferPipeline = this.device.createRenderPipeline({
            label: 'Hybrid G-buffer pipeline',
            layout: this.layouts.gbufferPipeline,
            vertex: {
                module: gbufferModule,
                entryPoint: 'vs_gbuffer',
                buffers: [
                    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
                    { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
                ],
            },
            fragment: {
                module: gbufferModule,
                entryPoint: 'fs_gbuffer',
                targets: [
                    { format: HYBRID_GBUFFER_FORMATS.worldPosition },
                    { format: HYBRID_GBUFFER_FORMATS.normal },
                    { format: HYBRID_GBUFFER_FORMATS.albedo },
                ],
            },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: {
                format: HYBRID_GBUFFER_FORMATS.depth,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        this.compositePipeline = this.device.createRenderPipeline({
            label: 'Hybrid composite pipeline',
            layout: this.layouts.compositePipeline,
            vertex: { module: compositeModule, entryPoint: 'vs_composite' },
            fragment: { module: compositeModule, entryPoint: 'fs_composite', targets: [{ format: this.format }] },
            primitive: { topology: 'triangle-list' },
        });
        this.compositeBindGroup = null;
    }

    setLight(partial = {}) {
        const next = { ...this.light, ...partial };
        if (!(next.type in LIGHT_TYPE)) throw new Error('Hybrid light type must be directional or point.');
        validateVector(next.type === 'point' ? next.position : next.direction, `Hybrid ${next.type} light vector`);
        validateVector(next.color, 'Hybrid light color');
        for (const field of ['intensity', 'ambient', 'exposure']) {
            if (!Number.isFinite(next[field]) || next[field] < 0) throw new Error(`Hybrid light ${field} must be non-negative and finite.`);
        }
        this.light = {
            ...next,
            direction: next.direction ? [...next.direction] : undefined,
            position: next.position ? [...next.position] : undefined,
            color: [...next.color],
        };
    }

    _destroyState(state) {
        if (!state || state.destroyed) return;
        state.destroyed = true;
        for (const primitive of state.primitives) {
            destroy(primitive.frameBuffer);
            destroy(primitive.materialBuffer);
        }
        this.liveStates.delete(state);
    }

    prepare(drawable) {
        if (this.destroyed) throw new Error('Cannot prepare a destroyed hybrid renderer.');
        if (!drawable || drawable.kind !== 'mesh') return;
        if (!this.initialized) this.init();
        const meshPrimitives = getMeshPrimitives(drawable);
        const current = this.drawableStates.get(drawable);
        if (!current || current.meshPrimitives.length !== meshPrimitives.length
            || !current.meshPrimitives.every((primitive, index) => primitive === meshPrimitives[index])) {
            this._destroyState(current);
            const state = {
                drawable,
                meshPrimitives,
                destroyed: false,
                primitives: meshPrimitives.map((primitive) => {
                    const frameBuffer = createUniformBuffer(this.device, HYBRID_FRAME_UNIFORM_SIZE);
                    const materialBuffer = createUniformBuffer(this.device, HYBRID_MATERIAL_UNIFORM_SIZE);
                    return {
                        frameBuffer,
                        materialBuffer,
                        frameData: new Float32Array(HYBRID_FRAME_UNIFORM_SIZE / 4),
                        materialData: new Float32Array(HYBRID_MATERIAL_UNIFORM_SIZE / 4),
                        frameBindGroup: this.device.createBindGroup({
                            layout: this.layouts.frame,
                            entries: [{ binding: 0, resource: { buffer: frameBuffer } }],
                        }),
                        materialBindGroup: this.device.createBindGroup({
                            layout: this.layouts.material,
                            entries: [
                                { binding: 0, resource: { buffer: materialBuffer } },
                                { binding: 1, resource: this.sampler },
                                { binding: 2, resource: (primitive.texture || this.defaultTexture).createView() },
                            ],
                        }),
                    };
                }),
            };
            this.drawableStates.set(drawable, state);
            this.liveStates.add(state);
        }
        this.drawable = drawable;
    }

    _ensureGBuffer(width, height) {
        if (this.gbuffer?.width === width && this.gbuffer?.height === height) return;
        const next = createHybridGBuffer(this.device, width, height);
        const previous = this.gbuffer;
        this.gbuffer = next;
        this.compositeBindGroup = null;
        destroyHybridGBuffer(previous);
    }

    _ensureCompositeBindGroup() {
        if (this.compositeBindGroup || !this.gbuffer || !this.compositePipeline) return;
        this.compositeBindGroup = this.device.createBindGroup({
            layout: this.layouts.composite,
            entries: [
                { binding: 0, resource: this.gbuffer.worldPosition.view },
                { binding: 1, resource: this.gbuffer.albedo.view },
                { binding: 2, resource: this.gbuffer.normal.view },
                { binding: 3, resource: this.visibilityFallback.createView() },
                { binding: 4, resource: { buffer: this.lightBuffer } },
            ],
        });
    }

    _uploadPrimitive(frame, primitive, state) {
        const userModel = frame.sceneState.modelViewMatrix || createIdentityMatrix();
        const model = multiplyMatrices(userModel, primitive.worldMatrix || createIdentityMatrix());
        const inverseModel = invertMatrix(model);
        state.frameData.set(frame.projectionMatrix, 0);
        state.frameData.set(frame.viewMatrix, 16);
        state.frameData.set(model, 32);
        state.frameData.set(inverseModel, 48);
        frame.device.queue.writeBuffer(state.frameBuffer, 0, state.frameData);

        state.materialData.fill(0);
        state.materialData.set(primitive.material?.baseColor || [1, 1, 1, 1], 0);
        new Uint32Array(state.materialData.buffer)[4] = primitive.texture ? 1 : 0;
        frame.device.queue.writeBuffer(state.materialBuffer, 0, state.materialData);
    }

    _uploadLight() {
        const data = new Float32Array(HYBRID_LIGHT_UNIFORM_SIZE / 4);
        data.set(this.light.type === 'point' ? this.light.position : this.light.direction, 0);
        data[3] = LIGHT_TYPE[this.light.type];
        data.set(this.light.color, 4);
        data[7] = this.light.intensity;
        data[8] = this.light.ambient;
        data[9] = this.light.exposure;
        this.device.queue.writeBuffer(this.lightBuffer, 0, data);
    }

    record(frame, drawable) {
        if (this.destroyed || !this.gbufferPipeline || !this.compositePipeline || !drawable) return;
        this.prepare(drawable);
        const state = this.drawableStates.get(drawable);
        if (!state?.meshPrimitives.length || frame.width < 1 || frame.height < 1) return;
        this._ensureGBuffer(frame.width, frame.height);
        this._ensureCompositeBindGroup();
        state.meshPrimitives.forEach((primitive, index) => this._uploadPrimitive(frame, primitive, state.primitives[index]));
        this._uploadLight();

        const gbufferPass = frame.encoder.beginRenderPass({
            label: 'Hybrid G-buffer pass',
            timestampWrites: frame.gpuTimer?.span('gbuffer'),
            colorAttachments: [
                { view: this.gbuffer.worldPosition.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
                { view: this.gbuffer.normal.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
                { view: this.gbuffer.albedo.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
            ],
            depthStencilAttachment: {
                view: this.gbuffer.depth.view,
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });
        gbufferPass.setPipeline(this.gbufferPipeline);
        state.meshPrimitives.forEach((primitive, index) => {
            gbufferPass.setBindGroup(0, state.primitives[index].frameBindGroup);
            gbufferPass.setBindGroup(1, state.primitives[index].materialBindGroup);
            gbufferPass.setVertexBuffer(0, primitive.buffers.position);
            gbufferPass.setVertexBuffer(1, primitive.buffers.normal);
            gbufferPass.setVertexBuffer(2, primitive.buffers.texCoord);
            gbufferPass.setIndexBuffer(primitive.buffers.indices, primitive.indexFormat || 'uint16');
            gbufferPass.drawIndexed(primitive.indexCount);
        });
        gbufferPass.end();

        const compositePass = frame.encoder.beginRenderPass({
            label: 'Hybrid composite pass',
            timestampWrites: frame.gpuTimer?.span('composite'),
            colorAttachments: [{
                view: frame.targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        compositePass.setPipeline(this.compositePipeline);
        compositePass.setBindGroup(0, this.compositeBindGroup);
        compositePass.draw(3);
        compositePass.end();
    }

    getStats() {
        return {
            backend: 'webgpu',
            renderMode: 'hybrid-shadows',
            drawableKind: this.drawable ? 'mesh' : 'none',
            triangleCount: this.drawable?.vertexCount ? this.drawable.vertexCount / 3 : 0,
            instanceCount: getMeshPrimitives(this.drawable).length,
            spp: 0,
        };
    }

    releaseDrawable(drawable) {
        if (!drawable) return;
        this._destroyState(this.drawableStates.get(drawable));
        if (this.drawable === drawable) this.drawable = null;
    }

    destroy() {
        if (this.destroyed) return;
        for (const state of [...this.liveStates]) this._destroyState(state);
        destroyHybridGBuffer(this.gbuffer);
        destroy(this.visibilityFallback);
        destroy(this.defaultTexture);
        destroy(this.lightBuffer);
        this.gbuffer = null;
        this.visibilityFallback = null;
        this.defaultTexture = null;
        this.lightBuffer = null;
        this.compositeBindGroup = null;
        this.destroyed = true;
    }
}
