/**
 * @file Abstract base class for WebGPU renderers (the IRenderer contract).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * A Renderer encapsulates everything that differs between drawable kinds
 * (pipeline, render pass, draw calls). The scene core owns the shared entities
 * — device, camera, per-frame view/projection matrices, the user-script tick,
 * resize, and the RAF loop — and dispatches to the renderer matching
 * `drawable.kind`. Subclasses must never re-implement those shared entities;
 * they consume them via the `frame` object passed to `record()`.
 */
export class Renderer {
    /**
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format - canvas swap-chain format
     */
    constructor(device, format) {
        this.device = device;
        this.format = format;
    }

    /** The `drawable.kind` this renderer handles (e.g. 'mesh', 'splat'). */
    get kind() {
        throw new Error('Renderer.kind not implemented');
    }

    /** Create GPU resources owned by this renderer. Called once from scene.start(). */
    init() {}

    /** Hook invoked when the active drawable changes (build/resize per-drawable GPU state). */
    prepare(_drawable) {}

    /**
     * Record this frame's compute/draw commands into `frame.encoder`.
     * @param {object} frame - shared per-frame state from the scene core:
     *   { device, encoder, targetView, camera, viewMatrix, projectionMatrix,
     *     width, height, deltaTime, sceneState }
     * @param {object} drawable - the active drawable (this renderer's `kind`)
     */
    record(_frame, _drawable) {
        throw new Error(`${this.kind} renderer: record() not implemented`);
    }

    /** Free GPU resources owned by a drawable of this renderer's kind. */
    releaseDrawable(_drawable) {}

    /** Free GPU resources owned by this renderer. */
    destroy() {}
}
