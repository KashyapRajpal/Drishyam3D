/**
 * @file ReductionStage — pluggable splat-set reducer/pre-orderer.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Axis 1 of the ordering matrix (see docs/splat-ordering.md). Reduces or
 * pre-orders the splat set before the SortBackend runs — None (passthrough),
 * Culled (frustum cull), Coarse (grid rank), LOD (merged Gaussians).
 */
export class ReductionStage {
    /** @param {GPUDevice} device */
    constructor(device) {
        this.device = device;
    }

    /** Backend id: 'none' | 'culled' | 'coarse' | 'lod'. */
    get name() {
        throw new Error('ReductionStage.name not implemented');
    }

    /** Compile any compute pipelines this reduction needs. */
    setShaders(_wgsl) {}

    /** Create device-lifetime resources (uniform buffers). */
    init() {}

    /** Build per-scene structures (grid/octree/hierarchy) at load. */
    prepare(_drawable) {}

    /**
     * Sort hook, invoked by the SortBackend after compute_keys and before the
     * sort steps. A reduction may mask sort keys (e.g. sink culled splats) and
     * return an indirect draw-args buffer so the renderer draws only the reduced
     * set. The base is a no-op (passthrough) — None keeps the sort byte-identical.
     * @returns {GPUBuffer|null} indirect draw-args buffer, or null for passthrough
     */
    maskKeys(_frame, _ctx) {
        return null;
    }

    /** Free per-drawable resources. */
    releaseDrawable(_drawable) {}

    /** Free device-lifetime resources. */
    destroy() {}
}
