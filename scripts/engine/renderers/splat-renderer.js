/**
 * @file SplatRenderer — 3D Gaussian Splatting path for the WebGPU backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Per frame: a compute pass generates view-space depth keys and bitonic-sorts
 * the splat indices back-to-front, then a no-depth premultiplied-blend pass
 * draws instanced billboards. A debug mode draws splat centers as points to
 * validate parsing/projection independently of the blend path.
 *
 * Shared entities (camera, view/projection matrices) arrive via `frame`; this
 * renderer owns only splat-specific GPU resources.
 */
import { Renderer } from './renderer.js';
import { createUniformBuffer } from '../webgpu-helpers.js';
import {
    createSortBuffers,
    createSplatRenderPipeline,
    createSplatDebugPipeline,
    createSortPipelines,
} from '../splat-helpers.js';

const WORKGROUP_SIZE = 256;
const RENDER_PARAMS_SIZE = 144; // proj(64) + view(64) + viewport(8) + pad(8)
const KEYS_PARAMS_SIZE = 80;    // view(64) + count(4) + padded(4) + pad(8)
const STEP_STRIDE = 256;        // 256B-aligned slice per bitonic stage

export class SplatRenderer extends Renderer {
    get kind() { return 'splat'; }

    constructor(device, format) {
        super(device, format);
        this.renderPipeline = null;
        this.debugPipeline = null;
        this.sortPipelines = null; // { keys, step }

        this.renderParamsBuffer = null;
        this.keysParamsBuffer = null;
        this.renderParamsData = new Float32Array(RENDER_PARAMS_SIZE / 4);
        this.keysParamsData = new ArrayBuffer(KEYS_PARAMS_SIZE);

        this.debugMode = 'off'; // 'off' | 'points'

        // Per-scene resources (rebuilt in prepare()).
        this.sort = null; // { indexBuffer, keyBuffer, paddedCount, stepBuffer, stages }
        this.bindGroups = null; // { render, debug, keys, steps: [] }
    }

    init() {
        this.renderParamsBuffer = createUniformBuffer(this.device, RENDER_PARAMS_SIZE);
        this.keysParamsBuffer = createUniformBuffer(this.device, KEYS_PARAMS_SIZE);
    }

    /** Build the splat, debug, and sort pipelines from WGSL sources. */
    setShaders(splatWgsl, sortWgsl) {
        this.renderPipeline = createSplatRenderPipeline(this.device, splatWgsl, this.format);
        this.debugPipeline = createSplatDebugPipeline(this.device, splatWgsl, this.format);
        this.sortPipelines = createSortPipelines(this.device, sortWgsl);
    }

    setDebugMode(mode) {
        this.debugMode = mode === 'points' ? 'points' : 'off';
    }

    /** Bitonic stage (k, j) sequence for a power-of-two length. */
    static _stages(padded) {
        const stages = [];
        for (let k = 2; k <= padded; k <<= 1) {
            for (let j = k >> 1; j > 0; j >>= 1) stages.push({ k, j });
        }
        return stages;
    }

    prepare(drawable) {
        this._releaseSort();
        if (!drawable || drawable.kind !== 'splat' || !drawable.count) return;
        if (!this.renderPipeline || !this.sortPipelines || !this.renderParamsBuffer) return;

        const { device } = this;
        const { storageBuffer, count } = drawable;

        const { indexBuffer, keyBuffer, paddedCount } = createSortBuffers(device, count);
        const stages = SplatRenderer._stages(paddedCount);

        // Precompute the per-stage (k, j, padded) uniforms — camera-independent.
        const stepBuffer = createUniformBuffer(device, Math.max(stages.length, 1) * STEP_STRIDE);
        if (stages.length > 0) {
            const u32 = new Uint32Array(stages.length * (STEP_STRIDE / 4));
            stages.forEach((s, i) => {
                const base = i * (STEP_STRIDE / 4);
                u32[base + 0] = s.k;
                u32[base + 1] = s.j;
                u32[base + 2] = paddedCount;
            });
            device.queue.writeBuffer(stepBuffer, 0, u32);
        }

        this.sort = { indexBuffer, keyBuffer, paddedCount, stepBuffer, stages, storageBuffer };

        // Bind groups (auto layouts differ per pipeline/entry point).
        const keysLayout = this.sortPipelines.keys.getBindGroupLayout(0);
        const stepLayout = this.sortPipelines.step.getBindGroupLayout(0);

        const steps = stages.map((_, i) => device.createBindGroup({
            layout: stepLayout,
            entries: [
                { binding: 4, resource: { buffer: stepBuffer, offset: i * STEP_STRIDE, size: 16 } },
                { binding: 2, resource: { buffer: keyBuffer } },
                { binding: 3, resource: { buffer: indexBuffer } },
            ],
        }));

        this.bindGroups = {
            keys: device.createBindGroup({
                layout: keysLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.keysParamsBuffer } },
                    { binding: 1, resource: { buffer: storageBuffer } },
                    { binding: 2, resource: { buffer: keyBuffer } },
                    { binding: 3, resource: { buffer: indexBuffer } },
                ],
            }),
            render: device.createBindGroup({
                layout: this.renderPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.renderParamsBuffer } },
                    { binding: 1, resource: { buffer: storageBuffer } },
                    { binding: 2, resource: { buffer: indexBuffer } },
                ],
            }),
            debug: device.createBindGroup({
                layout: this.debugPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.renderParamsBuffer } },
                    { binding: 1, resource: { buffer: storageBuffer } },
                ],
            }),
            steps,
        };
    }

    record(frame, drawable) {
        const { device, encoder, targetView, viewMatrix, projectionMatrix, width, height } = frame;
        if (!this.renderPipeline || !this.sort || !this.bindGroups || !drawable.count) return;

        // Upload render params (proj, view, viewport).
        this.renderParamsData.set(projectionMatrix, 0);
        this.renderParamsData.set(viewMatrix, 16);
        this.renderParamsData[32] = width;
        this.renderParamsData[33] = height;
        device.queue.writeBuffer(this.renderParamsBuffer, 0, this.renderParamsData);

        const colorAttachment = {
            view: targetView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        };

        if (this.debugMode === 'points') {
            const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });
            pass.setPipeline(this.debugPipeline);
            pass.setBindGroup(0, this.bindGroups.debug);
            pass.draw(drawable.count); // one point per splat
            pass.end();
            return;
        }

        // --- Depth sort (compute) ---
        const { paddedCount } = this.sort;
        const workgroups = Math.ceil(paddedCount / WORKGROUP_SIZE);

        // Keys params: view + count + padded.
        const kf = new Float32Array(this.keysParamsData);
        const ku = new Uint32Array(this.keysParamsData);
        kf.set(viewMatrix, 0);
        ku[16] = drawable.count;
        ku[17] = paddedCount;
        device.queue.writeBuffer(this.keysParamsBuffer, 0, this.keysParamsData);

        const compute = encoder.beginComputePass();
        compute.setPipeline(this.sortPipelines.keys);
        compute.setBindGroup(0, this.bindGroups.keys);
        compute.dispatchWorkgroups(workgroups);

        compute.setPipeline(this.sortPipelines.step);
        for (const stepGroup of this.bindGroups.steps) {
            compute.setBindGroup(0, stepGroup);
            compute.dispatchWorkgroups(workgroups);
        }
        compute.end();

        // --- Blend pass (instanced billboards, back-to-front) ---
        const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });
        pass.setPipeline(this.renderPipeline);
        pass.setBindGroup(0, this.bindGroups.render);
        pass.draw(4, drawable.count); // 4-vertex strip per splat instance
        pass.end();
    }

    _releaseSort() {
        if (!this.sort) return;
        this.sort.indexBuffer?.destroy?.();
        this.sort.keyBuffer?.destroy?.();
        this.sort.stepBuffer?.destroy?.();
        this.sort = null;
        this.bindGroups = null;
    }

    releaseDrawable(drawable) {
        // The storage buffer is owned by the drawable (created by the facade).
        if (drawable?.storageBuffer?.destroy) drawable.storageBuffer.destroy();
        this._releaseSort();
    }

    destroy() {
        this._releaseSort();
        this.renderParamsBuffer?.destroy?.();
        this.keysParamsBuffer?.destroy?.();
    }
}
