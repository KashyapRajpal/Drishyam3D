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

    /** Build per-scene structures (grid/octree/hierarchy) at load. */
    prepare(_drawable) {}

    /**
     * Record reduction compute passes into frame.encoder.
     * @returns {{ indexBuffer: GPUBuffer|null, count: number }}
     *   indexBuffer null ⇒ passthrough (sort seeds its own identity indices).
     */
    run(_frame, _drawable) {
        return { indexBuffer: null, count: _drawable?.count ?? 0 };
    }

    /** Free per-drawable resources. */
    releaseDrawable(_drawable) {}

    /** Free device-lifetime resources. */
    destroy() {}
}
