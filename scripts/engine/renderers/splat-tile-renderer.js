/**
 * @file SplatTileRenderer — compute-based tile renderer for 3D Gaussian Splatting.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Tile-based splatting architecture: preprocess (per-splat project/conic/SH),
 * scan + duplicate (per-tile key/value), sort (global depth), composite (per-tile
 * shared-memory front-to-back), blit (storage texture → swapchain).
 *
 * Step 1 (scaffold): a compute pass writes a test pattern into an rgba8unorm
 * storage texture, then a fullscreen blit samples it to the swapchain. Proves
 * the compute → storage-texture → blit plumbing before any splat math.
 */
import { Renderer } from './renderer.js';

const PATTERN_WORKGROUP = 8; // must match @workgroup_size in splat-tile-render.wgsl

export class SplatTileRenderer extends Renderer {
    get kind() { return 'splat'; }

    constructor(device, format) {
        super(device, format);
        this.blitPipeline = null;
        this.patternPipeline = null;

        // Output texture the compute pass writes and the blit pass samples.
        this.outputTexture = null;
        this.outputView = null;
        this.blitBindGroup = null;
        this.patternBindGroup = null;
        this.texWidth = 0;
        this.texHeight = 0;
    }

    init() {
        // Pipelines are built in setShaders() once the WGSL is available.
    }

    /**
     * Build the blit + compute pipelines.
     * @param {string} blitWgsl        fullscreen storage-texture → swapchain
     * @param {string} tileRenderWgsl  compute compositor (test pattern for now)
     */
    setShaders(blitWgsl, tileRenderWgsl) {
        if (!blitWgsl || !tileRenderWgsl) return;
        try {
            const blitModule = this.device.createShaderModule({ code: blitWgsl });
            // The blit needs no vertex buffers and no depth attachment, so it must
            // NOT use the mesh createRenderPipeline helper (which forces both).
            this.blitPipeline = this.device.createRenderPipeline({
                layout: 'auto',
                vertex: { module: blitModule, entryPoint: 'vs_main' },
                fragment: { module: blitModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
                primitive: { topology: 'triangle-list' },
            });

            const patternModule = this.device.createShaderModule({ code: tileRenderWgsl });
            this.patternPipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: { module: patternModule, entryPoint: 'cs_test_pattern' },
            });
        } catch (e) {
            console.error('SplatTileRenderer: failed to build pipelines:', e);
        }
        // Force texture/bind-group rebuild against the new pipeline layouts.
        this.texWidth = 0;
        this.texHeight = 0;
    }

    prepare(drawable) {
        if (!drawable || drawable.kind !== 'splat') return;
    }

    _ensureTexture(width, height) {
        if (this.outputTexture && this.texWidth === width && this.texHeight === height) return;
        if (!this.patternPipeline || !this.blitPipeline) return;

        this.outputTexture?.destroy?.();
        this.outputTexture = this.device.createTexture({
            size: [width, height, 1],
            format: 'rgba8unorm',
            // STORAGE_BINDING: compute writes it. TEXTURE_BINDING: blit samples it.
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.outputView = this.outputTexture.createView();
        this.texWidth = width;
        this.texHeight = height;

        this.patternBindGroup = this.device.createBindGroup({
            layout: this.patternPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: this.outputView }],
        });
        this.blitBindGroup = this.device.createBindGroup({
            layout: this.blitPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: this.outputView }],
        });
    }

    record(frame, drawable) {
        if (!drawable || drawable.kind !== 'splat') return;
        if (!this.blitPipeline || !this.patternPipeline) return;

        const { encoder, targetView, width, height } = frame;
        this._ensureTexture(width, height);
        if (!this.outputTexture) return;

        // --- Compute: write the test pattern into the storage texture ---
        const compute = encoder.beginComputePass();
        compute.setPipeline(this.patternPipeline);
        compute.setBindGroup(0, this.patternBindGroup);
        compute.dispatchWorkgroups(
            Math.ceil(width / PATTERN_WORKGROUP),
            Math.ceil(height / PATTERN_WORKGROUP),
        );
        compute.end();

        // --- Blit: sample the texture to the swapchain ---
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this.blitPipeline);
        pass.setBindGroup(0, this.blitBindGroup);
        pass.draw(3); // fullscreen triangle
        pass.end();
    }

    releaseDrawable() {
        // No drawable-specific resources yet.
    }

    destroy() {
        this.outputTexture?.destroy?.();
        this.outputTexture = null;
        this.outputView = null;
        this.blitBindGroup = null;
        this.patternBindGroup = null;
    }
}
