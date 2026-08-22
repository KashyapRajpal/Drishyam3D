import { Renderer } from './renderer.js';
import { getMeshPrimitives } from './mesh-renderer.js';
import { createIdentityMatrix, invertMatrix, multiplyMatrices } from '../matrix.js';
import { computeSceneBounds } from '../raytracing/core/ray-scene.js';
import {
    buildAccelerationStructures,
    updateAccelerationStructures,
} from '../raytracing/acceleration/acceleration-structure.js';
import { packGpuScene, repackGpuTlasAndInstances } from '../raytracing/gpu/gpu-scene-packer.js';
import {
    createGpuRaySceneResources,
    destroyGpuRaySceneResources,
    uploadGpuRayTlasAndInstances,
} from '../raytracing/gpu/gpu-ray-helpers.js';
import {
    createDefaultTexture,
    createSampler,
    createUniformBuffer,
} from '../webgpu-helpers.js';
import {
    HYBRID_GBUFFER_FORMATS,
    createHybridGBuffer,
    createHybridVisibilityFallback,
    createHybridVisibilityTarget,
    destroyHybridGBuffer,
    destroyHybridVisibilityTarget,
} from '../raytracing/hybrid/gbuffer-layout.js';

export const HYBRID_FRAME_UNIFORM_SIZE = 256;
export const HYBRID_LIGHT_UNIFORM_SIZE = 64;
export const HYBRID_SHADOW_UNIFORM_SIZE = 48;
const HYBRID_MATERIAL_UNIFORM_SIZE = 32;
const FRAME_FLAG_HAS_TLAS = 1;
const SHADOW_WORKGROUP_SIZE = 8;
const SCENE_BUFFER_NAMES = Object.freeze([
    'vertices', 'triangles', 'bvhNodes', 'bvhLeafReferences', 'instances', 'materials',
]);
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

function matrixKey(matrix) {
    return Array.from(matrix).join(',');
}

function createEffectiveScene(scene, userModel) {
    const instances = scene.instances.map((instance) => {
        const worldMatrix = multiplyMatrices(userModel, instance.worldMatrix);
        return { ...instance, worldMatrix, inverseWorldMatrix: invertMatrix(worldMatrix) };
    });
    const effective = { ...scene, instances };
    effective.bounds = computeSceneBounds(effective);
    return effective;
}

export class HybridShadowRenderer extends Renderer {
    get kind() { return 'mesh'; }

    constructor(device, format) {
        super(device, format);
        this.layouts = null;
        this.gbufferPipeline = null;
        this.compositePipeline = null;
        this.shadowPipeline = null;
        this.gbuffer = null;
        this.visibilityTarget = null;
        this.visibilityFallback = null;
        this.defaultTexture = null;
        this.sampler = null;
        this.lightBuffer = null;
        this.shadowUniformBuffer = null;
        this.compositeBindGroup = null;
        this.shadowAttachmentBindGroup = null;
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
        const shadowScene = this.device.createBindGroupLayout({
            label: 'Hybrid shadow scene layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', minBindingSize: HYBRID_SHADOW_UNIFORM_SIZE } },
                ...SCENE_BUFFER_NAMES.map((_name, index) => ({
                    binding: index + 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                })),
            ],
        });
        const shadowAttachments = this.device.createBindGroupLayout({
            label: 'Hybrid shadow attachment layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { access: 'write-only', format: HYBRID_GBUFFER_FORMATS.visibility },
                },
            ],
        });
        this.layouts = {
            frame,
            material,
            composite,
            shadowScene,
            shadowAttachments,
            gbufferPipeline: this.device.createPipelineLayout({ bindGroupLayouts: [frame, material] }),
            compositePipeline: this.device.createPipelineLayout({ bindGroupLayouts: [composite] }),
            shadowPipeline: this.device.createPipelineLayout({ bindGroupLayouts: [shadowScene, shadowAttachments] }),
        };
        this.sampler = createSampler(this.device);
        this.defaultTexture = createDefaultTexture(this.device);
        this.visibilityFallback = createHybridVisibilityFallback(this.device);
        this.lightBuffer = createUniformBuffer(this.device, HYBRID_LIGHT_UNIFORM_SIZE);
        this.shadowUniformBuffer = createUniformBuffer(this.device, HYBRID_SHADOW_UNIFORM_SIZE);
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

    setShadowShader(shadowSource) {
        if (!shadowSource) throw new Error('Hybrid shadow compute WGSL is required.');
        if (!this.initialized) this.init();
        const module = this.device.createShaderModule({ label: 'Hybrid any-hit shadow shader', code: shadowSource });
        this.shadowPipeline = this.device.createComputePipeline({
            label: 'Hybrid any-hit shadow pipeline',
            layout: this.layouts.shadowPipeline,
            compute: { module, entryPoint: 'cs_shadow' },
        });
        this.compositeBindGroup = null;
        this.shadowAttachmentBindGroup = null;
        for (const state of this.liveStates) {
            this._destroyShadowState(state);
        }
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
        this._destroyShadowState(state);
        for (const primitive of state.primitives) {
            destroy(primitive.frameBuffer);
            destroy(primitive.materialBuffer);
        }
        this.liveStates.delete(state);
    }

    _destroyShadowState(state) {
        if (!state?.shadow) return;
        destroyGpuRaySceneResources(state.shadow.sceneResources);
        state.shadow = null;
    }

    _createShadowSceneBindGroup(sceneResources) {
        return this.device.createBindGroup({
            label: 'Hybrid shadow scene bind group',
            layout: this.layouts.shadowScene,
            entries: [
                { binding: 0, resource: { buffer: this.shadowUniformBuffer } },
                ...SCENE_BUFFER_NAMES.map((name, index) => ({
                    binding: index + 1,
                    resource: { buffer: sceneResources.buffers[name] },
                })),
            ],
        });
    }

    _createFullShadowState(baseScene, userModel, revisions) {
        const effectiveScene = createEffectiveScene(baseScene, userModel);
        const acceleration = buildAccelerationStructures(effectiveScene, { revisions });
        const packedScene = packGpuScene(effectiveScene, acceleration);
        const sceneResources = createGpuRaySceneResources(this.device, packedScene);
        return {
            baseScene,
            effectiveScene,
            acceleration,
            packedScene,
            sceneResources,
            sceneBindGroup: this._createShadowSceneBindGroup(sceneResources),
            modelKey: matrixKey(userModel),
            geometryRevision: revisions.geometryRevision,
            sourceInstanceRevision: revisions.instanceRevision,
            dynamicInstanceRevision: revisions.instanceRevision,
        };
    }

    _ensureShadowScene(state, drawable, userModel) {
        if (!this.shadowPipeline) return null;
        const baseScene = drawable.rayTracing?.preparedRayScene;
        if (!baseScene) throw new Error('Hybrid shadows require a prepared RayScene sidecar.');
        const revisions = {
            geometryRevision: drawable.rayTracing.geometryRevision ?? 0,
            instanceRevision: drawable.rayTracing.instanceRevision ?? 0,
        };
        const nextModelKey = matrixKey(userModel);
        const needsFullRebuild = !state.shadow
            || state.shadow.baseScene !== baseScene
            || state.shadow.geometryRevision !== revisions.geometryRevision;
        if (needsFullRebuild) {
            this._destroyShadowState(state);
            state.shadow = this._createFullShadowState(baseScene, userModel, revisions);
            return state.shadow;
        }
        const transformChanged = state.shadow.modelKey !== nextModelKey
            || state.shadow.sourceInstanceRevision !== revisions.instanceRevision;
        if (!transformChanged) return state.shadow;

        const effectiveScene = createEffectiveScene(baseScene, userModel);
        const dynamicInstanceRevision = state.shadow.dynamicInstanceRevision + 1;
        const acceleration = updateAccelerationStructures(
            state.shadow.acceleration,
            effectiveScene,
            { geometryRevision: revisions.geometryRevision, instanceRevision: dynamicInstanceRevision },
        );
        try {
            const ranges = repackGpuTlasAndInstances(state.shadow.packedScene, effectiveScene, acceleration);
            uploadGpuRayTlasAndInstances(
                this.device,
                state.shadow.sceneResources,
                state.shadow.packedScene,
                ranges,
            );
            Object.assign(state.shadow, {
                effectiveScene,
                acceleration,
                modelKey: nextModelKey,
                sourceInstanceRevision: revisions.instanceRevision,
                dynamicInstanceRevision,
            });
        } catch (error) {
            if (!/requires stable instance, node, and leaf counts/.test(error.message)) throw error;
            this._destroyShadowState(state);
            state.shadow = this._createFullShadowState(baseScene, userModel, revisions);
        }
        return state.shadow;
    }

    prepare(drawable) {
        if (this.destroyed) throw new Error('Cannot prepare a destroyed hybrid renderer.');
        if (!drawable || drawable.kind !== 'mesh') return;
        if (!this.initialized) this.init();
        const meshPrimitives = getMeshPrimitives(drawable);
        const current = this.drawableStates.get(drawable);
        if (!current || current.destroyed || current.meshPrimitives.length !== meshPrimitives.length
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
        const visibilityReady = !this.shadowPipeline
            || (this.visibilityTarget?.width === width && this.visibilityTarget?.height === height);
        if (this.gbuffer?.width === width && this.gbuffer?.height === height && visibilityReady) return;
        const next = createHybridGBuffer(this.device, width, height);
        let nextVisibility = null;
        try {
            if (this.shadowPipeline) nextVisibility = createHybridVisibilityTarget(this.device, width, height);
        } catch (error) {
            destroyHybridGBuffer(next);
            throw error;
        }
        const previous = this.gbuffer;
        const previousVisibility = this.visibilityTarget;
        this.gbuffer = next;
        this.visibilityTarget = nextVisibility;
        this.compositeBindGroup = null;
        this.shadowAttachmentBindGroup = null;
        destroyHybridGBuffer(previous);
        destroyHybridVisibilityTarget(previousVisibility);
    }

    _ensureCompositeBindGroup() {
        if (this.compositeBindGroup || !this.gbuffer || !this.compositePipeline) return;
        this.compositeBindGroup = this.device.createBindGroup({
            layout: this.layouts.composite,
            entries: [
                { binding: 0, resource: this.gbuffer.worldPosition.view },
                { binding: 1, resource: this.gbuffer.albedo.view },
                { binding: 2, resource: this.gbuffer.normal.view },
                { binding: 3, resource: this.visibilityTarget?.view || this.visibilityFallback.createView() },
                { binding: 4, resource: { buffer: this.lightBuffer } },
            ],
        });
    }

    _ensureShadowAttachmentBindGroup() {
        if (this.shadowAttachmentBindGroup || !this.visibilityTarget) return;
        this.shadowAttachmentBindGroup = this.device.createBindGroup({
            label: 'Hybrid shadow attachment bind group',
            layout: this.layouts.shadowAttachments,
            entries: [
                { binding: 0, resource: this.gbuffer.worldPosition.view },
                { binding: 1, resource: this.gbuffer.normal.view },
                { binding: 2, resource: this.visibilityTarget.view },
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

    _uploadShadowUniforms(shadowState, width, height) {
        const buffer = new ArrayBuffer(HYBRID_SHADOW_UNIFORM_SIZE);
        const floats = new Float32Array(buffer);
        const integers = new Uint32Array(buffer);
        floats.set(this.light.type === 'point' ? this.light.position : this.light.direction, 0);
        floats[3] = LIGHT_TYPE[this.light.type];
        const sceneRadius = shadowState.effectiveScene.bounds?.radius || 0;
        floats[4] = 1e-4 * Math.max(1, sceneRadius);
        floats[5] = Math.max(1, sceneRadius * 4); // Twice the scene diagonal.
        integers[8] = width;
        integers[9] = height;
        integers[10] = shadowState.packedScene.metadata.tlasNodeCount > 0 ? FRAME_FLAG_HAS_TLAS : 0;
        this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, buffer);
    }

    record(frame, drawable) {
        if (this.destroyed || !this.gbufferPipeline || !this.compositePipeline || !drawable) return;
        this.prepare(drawable);
        const state = this.drawableStates.get(drawable);
        if (!state?.meshPrimitives.length || frame.width < 1 || frame.height < 1) return;
        const userModel = frame.sceneState.modelViewMatrix || createIdentityMatrix();
        const shadowState = this._ensureShadowScene(state, drawable, userModel);
        this._ensureGBuffer(frame.width, frame.height);
        this._ensureCompositeBindGroup();
        this._ensureShadowAttachmentBindGroup();
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

        if (shadowState && this.visibilityTarget) {
            this._uploadShadowUniforms(shadowState, frame.width, frame.height);
            const shadowPass = frame.encoder.beginComputePass({
                label: 'Hybrid any-hit shadow pass',
                timestampWrites: frame.gpuTimer?.span('shadow'),
            });
            shadowPass.setPipeline(this.shadowPipeline);
            shadowPass.setBindGroup(0, shadowState.sceneBindGroup);
            shadowPass.setBindGroup(1, this.shadowAttachmentBindGroup);
            shadowPass.dispatchWorkgroups(
                Math.ceil(frame.width / SHADOW_WORKGROUP_SIZE),
                Math.ceil(frame.height / SHADOW_WORKGROUP_SIZE),
            );
            shadowPass.end();
        }

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
        const shadow = this.drawable ? this.drawableStates.get(this.drawable)?.shadow : null;
        return {
            backend: 'webgpu',
            renderMode: 'hybrid-shadows',
            drawableKind: this.drawable ? 'mesh' : 'none',
            triangleCount: this.drawable?.vertexCount ? this.drawable.vertexCount / 3 : 0,
            instanceCount: getMeshPrimitives(this.drawable).length,
            spp: 0,
            blasBuildMs: shadow?.acceleration?.blasBuildMs || 0,
            tlasBuildMs: shadow?.acceleration?.tlasBuildMs || 0,
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
        destroyHybridVisibilityTarget(this.visibilityTarget);
        destroy(this.visibilityFallback);
        destroy(this.defaultTexture);
        destroy(this.lightBuffer);
        destroy(this.shadowUniformBuffer);
        this.gbuffer = null;
        this.visibilityTarget = null;
        this.visibilityFallback = null;
        this.defaultTexture = null;
        this.lightBuffer = null;
        this.shadowUniformBuffer = null;
        this.compositeBindGroup = null;
        this.shadowAttachmentBindGroup = null;
        this.shadowPipeline = null;
        this.destroyed = true;
    }
}
