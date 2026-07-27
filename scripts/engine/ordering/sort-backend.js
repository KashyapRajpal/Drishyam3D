/**
 * @file SortBackend — pluggable exact/approximate depth-ordering primitive.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Axis 2 of the ordering matrix (see docs/splat-ordering.md). A backend records
 * its compute passes into the frame encoder and exposes a back-to-front index
 * buffer the renderer draws from. Bitonic is the exact correctness oracle.
 */
export class SortBackend {
    /** @param {GPUDevice} device */
    constructor(device) {
        this.device = device;
    }

    /** Backend id: 'bitonic' | 'radix' | … */
    get name() {
        throw new Error('SortBackend.name not implemented');
    }

    /** The current back-to-front index buffer (valid after prepare()). */
    get indexBuffer() {
        return null;
    }

    /** Create device-lifetime resources (uniform buffers). */
    init() {}

    /** Compile pipelines from WGSL. */
    setShaders(_sortWgsl) {}

    /** Build per-scene buffers/bind groups for a drawable. */
    prepare(_drawable) {}

    /**
     * Record the ordering compute passes into frame.encoder. An optional
     * ReductionStage may hook in mid-sort (e.g. via maskKeys) to reject splats
     * and return indirect draw args, so the renderer draws only the reduced set.
     * @param {object} frame per-frame state (device, encoder, matrices, gpuTimer)
     * @param {object} drawable the splat drawable
     * @param {import('./reduction-stage.js').ReductionStage} [reduction] active reduction
     * @returns {{ indexBuffer: GPUBuffer|null, count: number, indirect: GPUBuffer|null }}
     */
    run(_frame, _drawable, _reduction) {
        throw new Error(`${this.name}: run() not implemented`);
    }

    /** Free per-drawable resources. */
    releaseDrawable(_drawable) {}

    /** Free device-lifetime resources. */
    destroy() {}
}
