import { Renderer } from './renderer.js';
import { createCameraFrame } from '../raytracing/core/camera-rays.js';
import {
    FRAME_FLAG_HAS_TLAS,
    packFrameUniforms,
} from '../raytracing/gpu/gpu-ray-layout.js';
import { packGpuScene } from '../raytracing/gpu/gpu-scene-packer.js';
import {
    advanceAccumulationTargets,
    assertRayTracingDeviceSupport,
    createGpuRayAccumulationBindGroups,
    createGpuRayBindGroupLayouts,
    createGpuRayDisplayBindGroups,
    createGpuRayFrameResources,
    createGpuRaySceneBindGroup,
    createGpuRaySceneResources,
    destroyAccumulationTargets,
    destroyGpuRayFrameResources,
    destroyGpuRaySceneResources,
    getAccumulationPair,
    resizeAccumulationTargets,
    uploadGpuRayFrameUniforms,
    uploadGpuRayTlasAndInstances,
} from '../raytracing/gpu/gpu-ray-helpers.js';

const WORKGROUP_SIZE = 8;
const DISPLAY_SHADER_MARKER = '// === RAYTRACE DISPLAY SHADER ===';
const DEFAULT_SETTINGS = Object.freeze({
    exposure: 1,
    environmentIntensity: 1,
    seed: 0x12345678,
});

function cameraKey(cameraFrame, width, height) {
    return [
        width,
        height,
        ...cameraFrame.eye,
        ...cameraFrame.forward,
        ...cameraFrame.up,
        cameraFrame.tanHalfFovY,
    ].join(',');
}

function firstLight(scene) {
    return scene.lights?.[0] || {
        type: 'rect',
        center: [0, 0, 0],
        u: [0, 0, 0],
        v: [0, 0, 0],
        color: [1, 1, 1],
        intensity: 0,
    };
}

/** WebGPU primary visibility, direct lighting, hard shadows, and display pass. */
export class RayTraceRenderer extends Renderer {
    get kind() { return 'raytrace'; }

    constructor(device, format) {
        super(device, format);
        this.layouts = null;
        this.frameResources = null;
        this.sceneResources = null;
        this.packedScene = null;
        this.drawable = null;
        this.tracePipeline = null;
        this.displayPipeline = null;
        this.sceneBindGroup = null;
        this.accumulationTargets = null;
        this.accumulationBindGroups = null;
        this.displayBindGroups = null;
        this.settings = { ...DEFAULT_SETTINGS };
        this.sampleCount = 0;
        this.lastCameraKey = null;
        this.initialized = false;
        this.destroyed = false;
    }

    init() {
        if (this.initialized) return;
        if (this.destroyed) throw new Error('Cannot initialize a destroyed ray tracing renderer.');
        assertRayTracingDeviceSupport(this.device);
        this.layouts = createGpuRayBindGroupLayouts(this.device);
        this.frameResources = createGpuRayFrameResources(this.device);
        this.initialized = true;
    }

    setShader(wgslSource) {
        if (!wgslSource) return;
        if (!this.initialized) this.init();
        const sections = wgslSource.split(DISPLAY_SHADER_MARKER);
        if (sections.length !== 2 || !sections[0].trim() || !sections[1].trim()) {
            throw new Error(`Ray tracing WGSL must contain one '${DISPLAY_SHADER_MARKER}' marker.`);
        }
        const traceModule = this.device.createShaderModule({ label: 'Ray tracing compute shader', code: sections[0] });
        const displayModule = this.device.createShaderModule({ label: 'Ray tracing display shader', code: sections[1] });
        this.tracePipeline = this.device.createComputePipeline({
            label: 'Ray tracing compute pipeline',
            layout: this.layouts.tracePipeline,
            compute: { module: traceModule, entryPoint: 'cs_raytrace' },
        });
        this.displayPipeline = this.device.createRenderPipeline({
            label: 'Ray tracing display pipeline',
            layout: this.layouts.displayPipeline,
            vertex: { module: displayModule, entryPoint: 'vs_fullscreen' },
            fragment: { module: displayModule, entryPoint: 'fs_display', targets: [{ format: this.format }] },
            primitive: { topology: 'triangle-list' },
        });
        this.rebuildBindGroups();
    }

    setShaders(wgslSource) {
        this.setShader(wgslSource);
    }

    setSettings(partial = {}) {
        const next = { ...this.settings, ...partial };
        for (const field of ['exposure', 'environmentIntensity']) {
            if (!Number.isFinite(next[field]) || next[field] < 0) throw new Error(`${field} must be a non-negative finite number.`);
        }
        if (!Number.isInteger(next.seed) || next.seed < 0 || next.seed > 0xffffffff) {
            throw new Error('seed must fit u32.');
        }
        const changed = Object.keys(next).some((key) => next[key] !== this.settings[key]);
        this.settings = next;
        if (changed) this.resetAccumulation();
    }

    prepare(drawable) {
        if (this.destroyed) throw new Error('Cannot prepare a destroyed ray tracing renderer.');
        if (!drawable || drawable.kind !== this.kind || !drawable.scene || !drawable.acceleration) return;
        if (!this.initialized) this.init();
        if (drawable === this.drawable && this.sceneResources) return;
        this.releaseDrawable(this.drawable);
        const packed = drawable.packedScene || packGpuScene(drawable.scene, drawable.acceleration);
        this.sceneResources = createGpuRaySceneResources(this.device, packed);
        this.packedScene = packed;
        this.drawable = drawable;
        this.sceneBindGroup = createGpuRaySceneBindGroup(
            this.device,
            this.layouts.scene,
            this.sceneResources,
            this.frameResources,
        );
        this.resetAccumulation();
    }

    /** Applies an already-packed transform-only update without replacing static buffers. */
    updateTlasAndInstances(drawable, packed, ranges) {
        if (drawable !== this.drawable || !this.sceneResources) {
            throw new Error('TLAS update requires the currently prepared ray drawable.');
        }
        uploadGpuRayTlasAndInstances(this.device, this.sceneResources, packed, ranges);
        this.packedScene = packed;
        this.resetAccumulation();
    }

    resetAccumulation() {
        this.sampleCount = 0;
        this.lastCameraKey = null;
        if (this.accumulationTargets && !this.accumulationTargets.destroyed) {
            this.accumulationTargets.readIndex = 0;
        }
    }

    rebuildBindGroups() {
        if (!this.accumulationTargets || !this.tracePipeline || !this.displayPipeline) return;
        this.accumulationBindGroups = createGpuRayAccumulationBindGroups(
            this.device,
            this.layouts.accumulation,
            this.accumulationTargets,
        );
        this.displayBindGroups = createGpuRayDisplayBindGroups(
            this.device,
            this.layouts.display,
            this.accumulationTargets,
            this.frameResources,
        );
    }

    ensureAccumulation(width, height) {
        const previous = this.accumulationTargets;
        this.accumulationTargets = resizeAccumulationTargets(this.device, previous, width, height);
        if (this.accumulationTargets !== previous) {
            this.sampleCount = 0;
            this.lastCameraKey = null;
            this.rebuildBindGroups();
        }
    }

    record(frame, drawable) {
        if (this.destroyed || drawable !== this.drawable || !this.sceneResources) return;
        if (!this.tracePipeline || !this.displayPipeline) return;
        const { device, encoder, targetView, camera, width, height } = frame;
        if (!(width > 0 && height > 0)) return;
        this.ensureAccumulation(width, height);
        const scene = drawable.scene;
        const cameraFrame = createCameraFrame({
            eye: camera.getPosition(),
            target: camera.target,
            up: camera.up,
            fovY: scene.camera?.fovY || 45 * Math.PI / 180,
            aspect: width / height,
        });
        const nextCameraKey = cameraKey(cameraFrame, width, height);
        if (this.lastCameraKey !== null && this.lastCameraKey !== nextCameraKey) this.sampleCount = 0;
        this.lastCameraKey = nextCameraKey;

        const light = firstLight(scene);
        const uniforms = packFrameUniforms({
            cameraFrame,
            width,
            height,
            sampleIndex: this.sampleCount,
            frameSeed: (this.settings.seed ^ this.sampleCount) >>> 0,
            maxBounces: 1,
            samplesPerFrame: 1,
            lightType: light.type || 'rect',
            flags: this.packedScene.metadata.tlasNodeCount > 0 ? FRAME_FLAG_HAS_TLAS : 0,
            rayEpsilon: 1e-4 * Math.max(1, scene.bounds?.radius || 0),
            exposure: this.settings.exposure,
            environmentIntensity: this.settings.environmentIntensity,
            environment: scene.environment?.color || [0, 0, 0],
            light,
        });
        uploadGpuRayFrameUniforms(device, this.frameResources, uniforms);
        device.queue.writeBuffer(
            this.frameResources.displayUniformBuffer,
            0,
            new Float32Array([this.settings.exposure, 0, 0, 0]),
        );

        const pair = getAccumulationPair(this.accumulationTargets);
        const compute = encoder.beginComputePass({ label: 'Ray tracing direct-light pass' });
        compute.setPipeline(this.tracePipeline);
        compute.setBindGroup(0, this.sceneBindGroup);
        compute.setBindGroup(1, this.accumulationBindGroups[pair.readIndex]);
        compute.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE), Math.ceil(height / WORKGROUP_SIZE));
        compute.end();

        const display = encoder.beginRenderPass({
            label: 'Ray tracing display pass',
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        display.setPipeline(this.displayPipeline);
        display.setBindGroup(0, this.displayBindGroups[pair.writeIndex]);
        display.draw(3);
        display.end();

        advanceAccumulationTargets(this.accumulationTargets);
        this.sampleCount += 1;
    }

    getStats() {
        return {
            backend: 'webgpu',
            renderMode: 'raytrace-gpu',
            drawableKind: this.drawable ? 'raytrace' : 'none',
            spp: this.sampleCount,
            triangleCount: this.packedScene?.metadata?.triangleCount || 0,
            instanceCount: this.packedScene?.metadata?.instanceCount || 0,
        };
    }

    releaseDrawable(drawable) {
        if (!this.drawable || (drawable && drawable !== this.drawable)) return;
        destroyGpuRaySceneResources(this.sceneResources);
        this.sceneResources = null;
        this.packedScene = null;
        this.sceneBindGroup = null;
        this.drawable = null;
        this.resetAccumulation();
    }

    destroy() {
        if (this.destroyed) return;
        this.releaseDrawable(this.drawable);
        destroyAccumulationTargets(this.accumulationTargets);
        destroyGpuRayFrameResources(this.frameResources);
        this.accumulationTargets = null;
        this.accumulationBindGroups = null;
        this.displayBindGroups = null;
        this.frameResources = null;
        this.tracePipeline = null;
        this.displayPipeline = null;
        this.destroyed = true;
    }
}
