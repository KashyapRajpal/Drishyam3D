/**
 * @file BitonicSortBackend — exact back-to-front depth sort (bitonic).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Wraps compute_keys + O(log²N) bitonic_step dispatches (splat-sort.wgsl). Exact
 * and deterministic — the correctness oracle other backends are scored against.
 * See docs/splat-ordering.md.
 */
import { SortBackend } from './sort-backend.js';
import { createUniformBuffer } from '../webgpu-helpers.js';
import { createSortBuffers, createSortPipelines } from '../splat-helpers.js';

const WORKGROUP_SIZE = 256;
const KEYS_PARAMS_SIZE = 80;  // view(64) + count(4) + padded(4) + pad(8)
const STEP_STRIDE = 256;      // 256B-aligned slice per bitonic stage

export class BitonicSortBackend extends SortBackend {
    get name() { return 'bitonic'; }

    constructor(device) {
        super(device);
        this.sortPipelines = null; // { keys, step }
        this.keysParamsBuffer = null;
        this.keysParamsData = new ArrayBuffer(KEYS_PARAMS_SIZE);
        this.sort = null;       // { indexBuffer, keyBuffer, paddedCount, stepBuffer, stages, storageBuffer }
        this.bindGroups = null; // { keys, steps: [] }
    }

    get indexBuffer() { return this.sort?.indexBuffer ?? null; }

    init() {
        this.keysParamsBuffer = createUniformBuffer(this.device, KEYS_PARAMS_SIZE);
    }

    setShaders(sortWgsl) {
        this.sortPipelines = createSortPipelines(this.device, sortWgsl);
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
        this._release();
        if (!drawable || drawable.kind !== 'splat' || !drawable.count) return;
        if (!this.sortPipelines || !this.keysParamsBuffer) return;

        const { device } = this;
        const { storageBuffer, count } = drawable;

        const { indexBuffer, keyBuffer, paddedCount } = createSortBuffers(device, count);
        const stages = BitonicSortBackend._stages(paddedCount);

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
            steps,
        };
    }

    /**
     * Records compute_keys, then the reduction's key-mask hook (optional), then
     * the bitonic_step passes. A reduction (e.g. Culled) that masks keys returns
     * an indirect draw-args buffer so the renderer draws only the reduced set.
     * @returns {{ indexBuffer: GPUBuffer, count: number, indirect: GPUBuffer|null }}
     */
    run(frame, drawable, reduction) {
        const { device, encoder, viewMatrix } = frame;
        if (!this.sortPipelines || !this.sort || !this.bindGroups || !drawable.count) {
            return { indexBuffer: this.indexBuffer, count: drawable.count, indirect: null };
        }

        const { paddedCount } = this.sort;
        const workgroups = Math.ceil(paddedCount / WORKGROUP_SIZE);

        // Keys params: view + count + padded.
        const kf = new Float32Array(this.keysParamsData);
        const ku = new Uint32Array(this.keysParamsData);
        kf.set(viewMatrix, 0);
        ku[16] = drawable.count;
        ku[17] = paddedCount;
        device.queue.writeBuffer(this.keysParamsBuffer, 0, this.keysParamsData);

        // Pass 1: depth keys + identity indices.
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.sortPipelines.keys);
            pass.setBindGroup(0, this.bindGroups.keys);
            pass.dispatchWorkgroups(workgroups);
            pass.end();
        }

        // Reduction hook: mask culled keys, count visible instances. Runs between
        // keys and steps so the sort then sinks culled splats past the visible set.
        let indirect = null;
        if (reduction && typeof reduction.maskKeys === 'function') {
            indirect = reduction.maskKeys(frame, {
                keyBuffer: this.sort.keyBuffer,
                splatBuffer: drawable.storageBuffer,
                count: drawable.count,
            });
        }

        // Pass 2: bitonic compare-exchange stages.
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.sortPipelines.step);
            for (const stepGroup of this.bindGroups.steps) {
                pass.setBindGroup(0, stepGroup);
                pass.dispatchWorkgroups(workgroups);
            }
            pass.end();
        }

        return { indexBuffer: this.sort.indexBuffer, count: drawable.count, indirect };
    }

    _release() {
        if (!this.sort) return;
        this.sort.indexBuffer?.destroy?.();
        this.sort.keyBuffer?.destroy?.();
        this.sort.stepBuffer?.destroy?.();
        this.sort = null;
        this.bindGroups = null;
    }

    releaseDrawable() {
        this._release();
    }

    destroy() {
        this._release();
        this.keysParamsBuffer?.destroy?.();
    }
}
