/**
 * @file MeshRenderer — opaque indexed-triangle path for the WebGPU backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
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

const LEGACY_UNTEXTURED_COLOR = Object.freeze([0.5, 0.5, 1, 1]);
const WHITE = Object.freeze([1, 1, 1, 1]);
const legacyPrimitiveLists = new WeakMap();

/**
 * Adapts old `{buffers, texture, vertexCount}` meshes without mutating them.
 * New glTF drawables already expose one entry per primitive instance.
 */
export function getMeshPrimitives(drawable) {
    if (Array.isArray(drawable?.primitives)) return drawable.primitives;
    if (!drawable?.buffers) return [];
    const cached = legacyPrimitiveLists.get(drawable);
    if (cached) return cached;
    const hasTexture = !!drawable.texture;
    const primitives = [{
        buffers: drawable.buffers,
        texture: drawable.texture ?? null,
        indexCount: drawable.vertexCount ?? 0,
        indexFormat: drawable.indexFormat ?? 'uint16',
        material: drawable.material || { baseColor: hasTexture ? WHITE : LEGACY_UNTEXTURED_COLOR },
        worldMatrix: createIdentityMatrix(),
        instanceIndex: 0,
    }];
    legacyPrimitiveLists.set(drawable, primitives);
    return primitives;
}

function destroyOnce(resource, destroyedResources) {
    if (!resource || destroyedResources.has(resource)) return;
    destroyedResources.add(resource);
    resource.destroy?.();
}

export class MeshRenderer extends Renderer {
    get kind() { return 'mesh'; }

    constructor(device, format) {
        super(device, format);
        this.pipeline = null;
        this.sampler = null;
        this.defaultTexture = null;
        this.depthTexture = null;
        this.depthWidth = 0;
        this.depthHeight = 0;
        this.drawableStates = new WeakMap();
        this.liveStates = new Set();
        this.releasedDrawables = new WeakSet();
        this.destroyedResources = new WeakSet();
        this.destroyed = false;
    }

    init() {
        if (this.destroyed || this.sampler) return;
        this.sampler = createSampler(this.device);
        this.defaultTexture = createDefaultTexture(this.device);
    }

    /** Set the render pipeline; its layout invalidates every cached bind group. */
    setPipeline(pipeline) {
        this.pipeline = pipeline;
        for (const state of this.liveStates) {
            for (const primitiveState of state.primitiveStates) primitiveState.bindGroup = null;
        }
    }

    _destroyState(state) {
        if (!state || state.released) return;
        state.released = true;
        for (const primitiveState of state.primitiveStates) {
            destroyOnce(primitiveState.matrixBuffer, this.destroyedResources);
            destroyOnce(primitiveState.materialBuffer, this.destroyedResources);
        }
        this.liveStates.delete(state);
    }

    _createState(drawable, primitives) {
        const state = {
            drawable,
            primitives,
            released: false,
            primitiveStates: primitives.map(() => ({
                matrixBuffer: createUniformBuffer(this.device, MATRIX_UNIFORM_SIZE),
                materialBuffer: createUniformBuffer(this.device, MATERIAL_UNIFORM_SIZE),
                matrixData: new Float32Array(32),
                materialData: new Float32Array(8),
                bindGroup: null,
                boundTexture: null,
            })),
        };
        this.drawableStates.set(drawable, state);
        this.liveStates.add(state);
        this.releasedDrawables.delete(drawable);
        return state;
    }

    prepare(drawable) {
        if (!drawable || this.destroyed) return;
        const primitives = getMeshPrimitives(drawable);
        const current = this.drawableStates.get(drawable);
        if (current && current.primitives.length === primitives.length
            && current.primitives.every((primitive, index) => primitive === primitives[index])) return;
        this._destroyState(current);
        this._createState(drawable, primitives);
    }

    _ensureState(drawable) {
        this.prepare(drawable);
        return this.drawableStates.get(drawable);
    }

    _ensureDepthTexture(width, height) {
        if (this.depthTexture && this.depthWidth === width && this.depthHeight === height) return;
        destroyOnce(this.depthTexture, this.destroyedResources);
        this.depthTexture = createDepthTexture(this.device, width, height);
        this.depthWidth = width;
        this.depthHeight = height;
    }

    _updatePrimitiveState(frame, primitive, primitiveState) {
        const userModel = frame.sceneState.modelViewMatrix || createIdentityMatrix();
        const instanceWorld = primitive.worldMatrix || createIdentityMatrix();
        const effectiveWorld = multiplyMatrices(userModel, instanceWorld);
        const modelViewMatrix = multiplyMatrices(frame.viewMatrix, effectiveWorld);
        primitiveState.matrixData.set(frame.projectionMatrix, 0);
        primitiveState.matrixData.set(modelViewMatrix, 16);
        frame.device.queue.writeBuffer(primitiveState.matrixBuffer, 0, primitiveState.matrixData);

        const hasTexture = primitive.texture ? 1 : 0;
        const baseColor = primitive.material?.baseColor || (hasTexture ? WHITE : LEGACY_UNTEXTURED_COLOR);
        primitiveState.materialData.fill(0);
        primitiveState.materialData.set(baseColor, 0);
        new Uint32Array(primitiveState.materialData.buffer)[4] = hasTexture;
        frame.device.queue.writeBuffer(primitiveState.materialBuffer, 0, primitiveState.materialData);

        const texture = primitive.texture || this.defaultTexture;
        if (!primitiveState.bindGroup || primitiveState.boundTexture !== texture) {
            primitiveState.bindGroup = createBindGroup(frame.device, this.pipeline, {
                matrixBuffer: primitiveState.matrixBuffer,
                materialBuffer: primitiveState.materialBuffer,
                sampler: this.sampler,
                texture,
            });
            primitiveState.boundTexture = texture;
        }
    }

    record(frame, drawable) {
        if (!this.pipeline || !drawable || this.destroyed) return;
        const state = this._ensureState(drawable);
        if (!state?.primitives.length) return;
        this._ensureDepthTexture(frame.width, frame.height);

        state.primitives.forEach((primitive, index) => {
            this._updatePrimitiveState(frame, primitive, state.primitiveStates[index]);
        });

        const pass = frame.encoder.beginRenderPass({
            colorAttachments: [{
                view: frame.targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        pass.setPipeline(this.pipeline);
        state.primitives.forEach((primitive, index) => {
            pass.setBindGroup(0, state.primitiveStates[index].bindGroup);
            pass.setVertexBuffer(0, primitive.buffers.position);
            pass.setVertexBuffer(1, primitive.buffers.normal);
            pass.setVertexBuffer(2, primitive.buffers.texCoord);
            pass.setIndexBuffer(primitive.buffers.indices, primitive.indexFormat ?? 'uint16');
            pass.drawIndexed(primitive.indexCount);
        });
        pass.end();
    }

    releaseDrawable(drawable) {
        if (!drawable || this.releasedDrawables.has(drawable)) return;
        this.releasedDrawables.add(drawable);
        this._destroyState(this.drawableStates.get(drawable));
        for (const primitive of getMeshPrimitives(drawable)) {
            destroyOnce(primitive.buffers?.position, this.destroyedResources);
            destroyOnce(primitive.buffers?.normal, this.destroyedResources);
            destroyOnce(primitive.buffers?.texCoord, this.destroyedResources);
            destroyOnce(primitive.buffers?.indices, this.destroyedResources);
            if (primitive.texture && primitive.texture !== this.defaultTexture) {
                destroyOnce(primitive.texture, this.destroyedResources);
            }
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const state of [...this.liveStates]) this.releaseDrawable(state.drawable);
        destroyOnce(this.depthTexture, this.destroyedResources);
        destroyOnce(this.defaultTexture, this.destroyedResources);
        this.depthTexture = null;
        this.defaultTexture = null;
    }
}
