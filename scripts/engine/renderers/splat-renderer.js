/**
 * @file SplatRenderer — 3D Gaussian Splatting path for the WebGPU backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Draws splats as instanced premultiplied-alpha billboards. Depth ordering is
 * delegated to a pluggable SortBackend and the splat set to a ReductionStage
 * (see docs/splat-ordering.md); this renderer owns only the render/debug
 * pipelines, the render-params buffer, and the blend pass. A debug mode draws
 * splat centers as points to validate parsing/projection independently.
 *
 * Shared entities (camera, view/projection matrices) arrive via `frame`.
 */
import { Renderer } from './renderer.js';
import { createUniformBuffer } from '../webgpu-helpers.js';
import {
    createSplatRenderPipeline,
    createSplatDebugPipeline,
    shCoeffCount,
} from '../splat-helpers.js';
import { BitonicSortBackend } from '../ordering/bitonic-backend.js';
import { RadixSortBackend } from '../ordering/radix-backend.js';
import { NoneReduction } from '../ordering/none-reduction.js';
import { CulledReduction } from '../ordering/culled-reduction.js';

// proj(64) + view(64) + viewport(8) + shStride(4) + pad(4) + camPos(12) + shDegree(4).
// camPos lands at byte 144, 16-byte aligned as WGSL requires for vec3.
const RENDER_PARAMS_SIZE = 160;

export class SplatRenderer extends Renderer {
    get kind() { return 'splat'; }

    constructor(device, format) {
        super(device, format);
        this.renderPipeline = null;
        this.debugPipeline = null;

        this.renderParamsBuffer = null;
        this.renderParamsData = new Float32Array(RENDER_PARAMS_SIZE / 4);
        // Aliased u32 view so shStride/shDegree can share the render-params scratch.
        this.renderParamsU32 = new Uint32Array(this.renderParamsData.buffer);

        this.debugMode = 'off'; // 'off' | 'points'
        // Upper bound on SH degree, for A/B-ing view-dependent colour in the UI.
        this.maxShDegree = 3;

        // Pluggable ordering (see docs/splat-ordering.md). Both axes swap at
        // runtime: sort between Bitonic (exact oracle) and Radix via setSort(),
        // reduction between None (passthrough) and Culled via setReduction().
        this.bitonicSort = new BitonicSortBackend(device);
        this.radixSort = new RadixSortBackend(device);
        this.sortBackend = this.bitonicSort;
        this.noneReduction = new NoneReduction(device);
        this.culledReduction = new CulledReduction(device);
        this.reduction = this.noneReduction;

        this.renderBindGroup = null;
        this.debugBindGroup = null;
        // Held so setSort() can rebuild the render bind group, which binds the
        // *active* backend's index buffer.
        this.drawable = null;
    }

    init() {
        this.renderParamsBuffer = createUniformBuffer(this.device, RENDER_PARAMS_SIZE);
        this.bitonicSort.init();
        this.radixSort.init();
        this.noneReduction.init();
        this.culledReduction.init();
    }

    /** Build the render + debug pipelines; hand the sort + cull WGSL to the backends. */
    setShaders(splatWgsl, sortWgsl, cullWgsl, radixWgsl) {
        this.renderPipeline = createSplatRenderPipeline(this.device, splatWgsl, this.format);
        this.debugPipeline = createSplatDebugPipeline(this.device, splatWgsl, this.format);
        this.bitonicSort.setShaders(sortWgsl);
        this.radixSort.setShaders(sortWgsl, radixWgsl);
        if (cullWgsl) this.culledReduction.setShaders(cullWgsl);
    }

    setDebugMode(mode) {
        this.debugMode = mode === 'points' ? 'points' : 'off';
    }

    /** Select the reduction axis: 'none' (passthrough) or 'culled' (frustum cull). */
    setReduction(mode) {
        this.reduction = mode === 'culled' ? this.culledReduction : this.noneReduction;
    }

    /**
     * Select the sort axis: 'bitonic' (exact oracle) or 'radix'.
     *
     * Unlike the reduction axis, this must re-prepare: the render bind group
     * holds the *previous* backend's index buffer, so drawing without a rebuild
     * would read a stale (or destroyed) buffer. The outgoing backend's
     * per-drawable buffers are released so only the active one is resident.
     */
    setSort(mode) {
        const next = mode === 'radix' ? this.radixSort : this.bitonicSort;
        if (next === this.sortBackend) return;
        this.sortBackend.releaseDrawable(this.drawable);
        this.sortBackend = next;
        if (this.drawable) this.prepare(this.drawable);
    }

    /** Debug info for the stats overlay: active sort/reduction + visible-splat count. */
    getReductionInfo() {
        return {
            mode: this.reduction.name,
            sort: this.sortBackend.name,
            visible: this.reduction.lastVisibleCount ?? -1, // -1 ⇒ not culling (all visible)
        };
    }

    /** Clamp the SH degree used for shading (0 = flat DC colour). */
    setMaxShDegree(degree) {
        this.maxShDegree = Math.max(0, Math.min(3, degree | 0));
    }

    prepare(drawable) {
        this.renderBindGroup = null;
        this.debugBindGroup = null;
        this.drawable = drawable ?? null;
        if (!drawable || drawable.kind !== 'splat' || !drawable.count || !drawable.shBuffer) return;
        if (!this.renderPipeline || !this.renderParamsBuffer) return;

        this.reduction.prepare(drawable);
        this.sortBackend.prepare(drawable);
        const indexBuffer = this.sortBackend.indexBuffer;
        if (!indexBuffer) return;

        const { device } = this;
        const { storageBuffer } = drawable;

        this.renderBindGroup = device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.renderParamsBuffer } },
                { binding: 1, resource: { buffer: storageBuffer } },
                { binding: 2, resource: { buffer: indexBuffer } },
                { binding: 3, resource: { buffer: drawable.shBuffer } },
            ],
        });
        this.debugBindGroup = device.createBindGroup({
            layout: this.debugPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.renderParamsBuffer } },
                { binding: 1, resource: { buffer: storageBuffer } },
            ],
        });
    }

    record(frame, drawable) {
        const { device, encoder, targetView, camera, viewMatrix, projectionMatrix, width, height } = frame;
        if (!this.renderPipeline || !drawable.count) return;

        // Upload render params (proj, view, viewport, camera position, SH stride/degree).
        this.renderParamsData.set(projectionMatrix, 0);
        this.renderParamsData.set(viewMatrix, 16);
        this.renderParamsData[32] = width;
        this.renderParamsData[33] = height;
        // Buffer stride is fixed by the loaded scene; the displayed degree is clamped
        // independently, so lowering it must not shift where each splat's SH starts.
        this.renderParamsU32[34] = shCoeffCount(drawable.shDegree ?? 0);
        const eye = camera?.getPosition?.() ?? [0, 0, 0];
        this.renderParamsData[36] = eye[0];
        this.renderParamsData[37] = eye[1];
        this.renderParamsData[38] = eye[2];
        this.renderParamsU32[39] = Math.min(drawable.shDegree ?? 0, this.maxShDegree);
        device.queue.writeBuffer(this.renderParamsBuffer, 0, this.renderParamsData);

        const colorAttachment = {
            view: targetView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        };

        if (this.debugMode === 'points') {
            if (!this.debugBindGroup) return;
            const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });
            pass.setPipeline(this.debugPipeline);
            pass.setBindGroup(0, this.debugBindGroup);
            pass.draw(drawable.count); // one point per splat
            pass.end();
            return;
        }

        if (!this.renderBindGroup) return;

        // Sort back-to-front; the active reduction may mask culled keys mid-sort and
        // return indirect draw args (see docs/splat-ordering.md).
        const sortResult = this.sortBackend.run(frame, drawable, this.reduction);

        // --- Blend pass (instanced billboards, back-to-front) ---
        // Timed as 'render': with no early-out, every splat rasterizes its full
        // quad, so this pass — not the sort — is what dominates large scenes.
        // Measuring it directly beats inferring it by subtracting sort from fps.
        const renderTs = frame.gpuTimer?.span('render');
        const pass = encoder.beginRenderPass({
            colorAttachments: [colorAttachment],
            ...(renderTs ? { timestampWrites: renderTs } : {}),
        });
        pass.setPipeline(this.renderPipeline);
        pass.setBindGroup(0, this.renderBindGroup);
        if (sortResult?.indirect) {
            pass.drawIndirect(sortResult.indirect, 0); // only the visible instance count
        } else {
            pass.draw(4, drawable.count); // 4-vertex strip per splat instance
        }
        pass.end();
    }

    releaseDrawable(drawable) {
        // The storage and SH buffers are owned by the drawable (created by the facade).
        if (drawable?.storageBuffer?.destroy) drawable.storageBuffer.destroy();
        if (drawable?.shBuffer?.destroy) drawable.shBuffer.destroy();
        this.bitonicSort.releaseDrawable(drawable);
        this.radixSort.releaseDrawable(drawable);
        this.noneReduction.releaseDrawable(drawable);
        this.culledReduction.releaseDrawable(drawable);
        this.renderBindGroup = null;
        this.debugBindGroup = null;
        this.drawable = null;
    }

    destroy() {
        this.bitonicSort.destroy();
        this.radixSort.destroy();
        this.noneReduction.destroy();
        this.culledReduction.destroy();
        this.renderParamsBuffer?.destroy?.();
    }
}
