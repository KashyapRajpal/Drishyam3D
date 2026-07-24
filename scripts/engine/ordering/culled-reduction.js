/**
 * @file CulledReduction — frustum-cull the splat set before the depth sort.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Axis-1 reduction (see docs/splat-ordering.md). Builds a uniform grid over splat
 * centers at load, then each frame tests every cell's AABB against the view
 * frustum (cull_cells) and sinks culled splats' sort keys (apply_cull), returning
 * an indirect draw-args buffer whose instanceCount is the visible splat count.
 *
 * Integrates via the sort's maskKeys() hook — it runs AFTER compute_keys and
 * BEFORE the bitonic steps, so splat-sort.wgsl is never modified and the None
 * reduction path stays byte-identical.
 */
import { ReductionStage } from './reduction-stage.js';
import { buildGrid } from './spatial/grid.js';
import { extractFrustumPlanes, viewProjection, cellVisibility } from './spatial/frustum.js';
import { createUniformBuffer } from '../webgpu-helpers.js';

const CULL_PARAMS_SIZE = 144; // planes(96) + gridMin(16) + cellSize(12)+dim(4) + cellCount+splatCount+pad
const CULL_WORKGROUP = 64;    // matches @workgroup_size in cull_cells
const APPLY_WORKGROUP = 256;  // matches @workgroup_size in apply_cull
const GRID_DIM = 16;

export class CulledReduction extends ReductionStage {
    get name() { return 'culled'; }

    constructor(device) {
        super(device);
        this.cullPipeline = null;
        this.applyPipeline = null;
        this.cullParamsBuffer = null;
        this.cullParamsData = new ArrayBuffer(CULL_PARAMS_SIZE);
        this.grid = null;
        this.cellVisibleBuffer = null;
        this.indirectBuffer = null;
        this.cullBindGroup = null;
        this.applyBindGroup = null;
        this._keyBuffer = null; // cached to detect when the apply bind group must rebuild
        this.lastVisibleCount = -1; // debug: splats surviving the cull last frame (-1 = unknown)
    }

    init() {
        this.cullParamsBuffer = createUniformBuffer(this.device, CULL_PARAMS_SIZE);
    }

    setShaders(cullWgsl) {
        if (!cullWgsl) return;
        const module = this.device.createShaderModule({ code: cullWgsl });
        this.cullPipeline = this.device.createComputePipeline({
            layout: 'auto', compute: { module, entryPoint: 'cull_cells' },
        });
        this.applyPipeline = this.device.createComputePipeline({
            layout: 'auto', compute: { module, entryPoint: 'apply_cull' },
        });
        this._keyBuffer = null;
    }

    prepare(drawable) {
        this._release();
        if (!drawable || drawable.kind !== 'splat' || !drawable.count || !drawable.positions) return;
        if (!this.cullPipeline || !this.cullParamsBuffer) return;

        const { device } = this;
        this.grid = buildGrid(drawable.positions, drawable.count, { dim: GRID_DIM });

        this.cellVisibleBuffer = device.createBuffer({
            size: Math.max(this.grid.cellCount, 1) * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.indirectBuffer = device.createBuffer({
            size: 16, // [vertexCount, instanceCount, firstVertex, firstInstance]
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.cullBindGroup = device.createBindGroup({
            layout: this.cullPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.cullParamsBuffer } },
                { binding: 1, resource: { buffer: this.cellVisibleBuffer } },
            ],
        });
        this._keyBuffer = null; // apply bind group is built lazily (needs the sort's key buffer)
    }

    /**
     * Sort hook: reject culled splats' keys and count the visible instances.
     * @param {object} frame per-frame state (encoder, view/projection matrices)
     * @param {{keyBuffer: GPUBuffer, splatBuffer: GPUBuffer, count: number}} ctx
     * @returns {GPUBuffer|null} indirect draw-args buffer, or null if inactive
     */
    maskKeys(frame, { keyBuffer, splatBuffer, count }) {
        if (!this.cullPipeline || !this.applyPipeline || !this.grid || !this.cellVisibleBuffer) return null;
        const { device, encoder, viewMatrix, projectionMatrix } = frame;

        // Upload cull params: 6 frustum planes + grid descriptor.
        const vp = viewProjection(projectionMatrix, viewMatrix);
        const planes = extractFrustumPlanes(vp);

        // Debug: exact visible-splat count, computed CPU-side from the grid using the
        // same cell-visibility test the GPU runs (sum the populations of visible cells).
        // Cheap — cellCount (≈4096) plane tests — and matches apply_cull's atomic count.
        const cellVis = cellVisibility(this.grid, planes);
        let visible = 0;
        const cs = this.grid.cellStart;
        for (let c = 0; c < this.grid.cellCount; c++) {
            if (cellVis[c]) visible += cs[c + 1] - cs[c];
        }
        this.lastVisibleCount = visible;

        const f = new Float32Array(this.cullParamsData);
        const u = new Uint32Array(this.cullParamsData);
        for (let i = 0; i < 6; i++) {
            f[i * 4 + 0] = planes[i][0];
            f[i * 4 + 1] = planes[i][1];
            f[i * 4 + 2] = planes[i][2];
            f[i * 4 + 3] = planes[i][3];
        }
        // WGSL std140-ish layout: a vec3 has size 12 / align 16, so the scalars
        // after cellSize pack at byte 124 onward — NOT 128. Offsets are in
        // 4-byte words: gridMin@24, cellSize@28, dim@31, cellCount@32, splatCount@33.
        f[24] = this.grid.min[0]; f[25] = this.grid.min[1]; f[26] = this.grid.min[2]; // gridMin  (byte 96)
        f[28] = this.grid.cellSize[0]; f[29] = this.grid.cellSize[1]; f[30] = this.grid.cellSize[2]; // cellSize (byte 112)
        u[31] = this.grid.dim;       // byte 124
        u[32] = this.grid.cellCount; // byte 128
        u[33] = count;               // byte 132 (splatCount)
        device.queue.writeBuffer(this.cullParamsBuffer, 0, this.cullParamsData);

        // Reset indirect args: vertexCount=4, instanceCount=0, first*=0.
        device.queue.writeBuffer(this.indirectBuffer, 0, new Uint32Array([4, 0, 0, 0]));

        if (this._keyBuffer !== keyBuffer) {
            this.applyBindGroup = device.createBindGroup({
                layout: this.applyPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.cullParamsBuffer } },
                    { binding: 1, resource: { buffer: this.cellVisibleBuffer } },
                    { binding: 2, resource: { buffer: splatBuffer } },
                    { binding: 3, resource: { buffer: keyBuffer } },
                    { binding: 4, resource: { buffer: this.indirectBuffer } },
                ],
            });
            this._keyBuffer = keyBuffer;
        }

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.cullPipeline);
        pass.setBindGroup(0, this.cullBindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.grid.cellCount / CULL_WORKGROUP));
        pass.setPipeline(this.applyPipeline);
        pass.setBindGroup(0, this.applyBindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / APPLY_WORKGROUP));
        pass.end();

        return this.indirectBuffer;
    }

    _release() {
        this.cellVisibleBuffer?.destroy?.();
        this.indirectBuffer?.destroy?.();
        this.cellVisibleBuffer = null;
        this.indirectBuffer = null;
        this.cullBindGroup = null;
        this.applyBindGroup = null;
        this.grid = null;
        this._keyBuffer = null;
        this.lastVisibleCount = -1;
    }

    releaseDrawable() { this._release(); }

    destroy() {
        this._release();
        this.cullParamsBuffer?.destroy?.();
    }
}
