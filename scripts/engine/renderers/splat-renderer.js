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

        // Pluggable ordering (see docs/splat-ordering.md). Sort axis is fixed to
        // Bitonic for now; the reduction axis swaps between None (passthrough) and
        // Culled (frustum cull) via setReduction().
        this.sortBackend = new BitonicSortBackend(device);
        this.noneReduction = new NoneReduction(device);
        this.culledReduction = new CulledReduction(device);
        this.reduction = this.noneReduction;

        this.renderBindGroup = null;
        this.debugBindGroup = null;
    }

    init() {
        this.renderParamsBuffer = createUniformBuffer(this.device, RENDER_PARAMS_SIZE);
        this.sortBackend.init();
        this.noneReduction.init();
        this.culledReduction.init();
    }

    /** Build the render + debug pipelines; hand the sort + cull WGSL to the backends. */
    setShaders(splatWgsl, sortWgsl, cullWgsl) {
        this.renderPipeline = createSplatRenderPipeline(this.device, splatWgsl, this.format);
        this.debugPipeline = createSplatDebugPipeline(this.device, splatWgsl, this.format);
        this.sortBackend.setShaders(sortWgsl);
        if (cullWgsl) this.culledReduction.setShaders(cullWgsl);
    }

    setDebugMode(mode) {
        this.debugMode = mode === 'points' ? 'points' : 'off';
    }

    /** Select the reduction axis: 'none' (passthrough) or 'culled' (frustum cull). */
    setReduction(mode) {
        this.reduction = mode === 'culled' ? this.culledReduction : this.noneReduction;
    }

    /** Debug info for the stats overlay: active reduction + last visible-splat count. */
    getReductionInfo() {
        return {
            mode: this.reduction.name,
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
        const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });
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
        this.sortBackend.releaseDrawable(drawable);
        this.noneReduction.releaseDrawable(drawable);
        this.culledReduction.releaseDrawable(drawable);
        this.renderBindGroup = null;
        this.debugBindGroup = null;
    }

    destroy() {
        this.sortBackend.destroy();
        this.noneReduction.destroy();
        this.culledReduction.destroy();
        this.renderParamsBuffer?.destroy?.();
    }
}
