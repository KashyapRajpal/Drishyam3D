import { Renderer } from './renderer.js';
import { createCameraFrame } from '../raytracing/core/camera-rays.js';
import {
    DIAGNOSTICS_SIZE,
    FRAME_FLAG_HAS_TLAS,
    packFrameUniforms,
} from '../raytracing/gpu/gpu-ray-layout.js';
import { packGpuScene } from '../raytracing/gpu/gpu-scene-packer.js';
import {
    advanceAccumulationTargets,
    assertRayTracingDeviceSupport,
    clearGpuRayDiagnostics,
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
const MAX_BOUNCES = 16;
const MAX_SAMPLES_PER_FRAME = 16;
const REVISION_FIELDS = Object.freeze([
    'geometryRevision',
    'instanceRevision',
    'materialRevision',
    'lightRevision',
    'cameraRevision',
    'settingsRevision',
]);
const DEFAULT_SETTINGS = Object.freeze({
    exposure: 1,
    environmentIntensity: 1,
    seed: 0x12345678,
    maxBounces: 4,
    samplesPerFrame: 1,
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

function revisionsKey(revisions = {}) {
    return REVISION_FIELDS.map((field) => {
        const value = revisions[field] ?? 0;
        if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
        return value;
    }).join(':');
}

function float16ToNumber(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) return sign * fraction * (2 ** -24);
    if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
    return sign * (1 + fraction / 1024) * (2 ** (exponent - 15));
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
        this.lastRevisionKey = null;
        this.diagnostics = { stackOverflows: 0, nonFinite: 0, rays: 0 };
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
        if (!Number.isInteger(next.maxBounces) || next.maxBounces < 1 || next.maxBounces > MAX_BOUNCES) {
            throw new Error(`maxBounces must be an integer in [1, ${MAX_BOUNCES}].`);
        }
        if (!Number.isInteger(next.samplesPerFrame)
            || next.samplesPerFrame < 1
            || next.samplesPerFrame > MAX_SAMPLES_PER_FRAME) {
            throw new Error(`samplesPerFrame must be an integer in [1, ${MAX_SAMPLES_PER_FRAME}].`);
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
        this.lastRevisionKey = null;
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
        const nextRevisionKey = revisionsKey(drawable.revisions);
        if ((this.lastCameraKey !== null && this.lastCameraKey !== nextCameraKey)
            || (this.lastRevisionKey !== null && this.lastRevisionKey !== nextRevisionKey)) {
            this.sampleCount = 0;
            this.accumulationTargets.readIndex = 0;
        }
        this.lastCameraKey = nextCameraKey;
        this.lastRevisionKey = nextRevisionKey;

        const light = firstLight(scene);
        const uniforms = packFrameUniforms({
            cameraFrame,
            width,
            height,
            sampleIndex: this.sampleCount,
            frameSeed: this.settings.seed,
            maxBounces: this.settings.maxBounces,
            samplesPerFrame: this.settings.samplesPerFrame,
            lightType: light.type || 'rect',
            flags: this.packedScene.metadata.tlasNodeCount > 0 ? FRAME_FLAG_HAS_TLAS : 0,
            rayEpsilon: 1e-4 * Math.max(1, scene.bounds?.radius || 0),
            exposure: this.settings.exposure,
            environmentIntensity: this.settings.environmentIntensity,
            environment: scene.environment?.color || [0, 0, 0],
            light,
        });
        uploadGpuRayFrameUniforms(device, this.frameResources, uniforms);
        clearGpuRayDiagnostics(device, this.frameResources);
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
        const diagnosticsMapState = this.frameResources.diagnosticsReadbackBuffer.mapState;
        if (encoder.copyBufferToBuffer && (diagnosticsMapState == null || diagnosticsMapState === 'unmapped')) {
            encoder.copyBufferToBuffer(
                this.frameResources.diagnosticsBuffer,
                0,
                this.frameResources.diagnosticsReadbackBuffer,
                0,
                DIAGNOSTICS_SIZE,
            );
        }

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
        this.sampleCount += this.settings.samplesPerFrame;
    }

    async readDiagnostics() {
        const buffer = this.frameResources?.diagnosticsReadbackBuffer;
        if (!buffer?.mapAsync || buffer.mapState === 'pending' || buffer.mapState === 'mapped') {
            return { ...this.diagnostics };
        }
        await buffer.mapAsync(GPUMapMode.READ);
        const values = new Uint32Array(buffer.getMappedRange()).slice(0, DIAGNOSTICS_SIZE / 4);
        buffer.unmap();
        this.diagnostics = {
            stackOverflows: values[0],
            nonFinite: values[1],
            rays: values[2],
        };
        return { ...this.diagnostics };
    }

    /** Deterministic rgba16float readback hook used by GPU/CPU parity tests. */
    async readAccumulation() {
        if (!this.accumulationTargets || this.sampleCount === 0) {
            throw new Error('No ray tracing accumulation is available to read.');
        }
        const { width, height, textures, readIndex } = this.accumulationTargets;
        const unpaddedBytesPerRow = width * 8;
        const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
        const readback = this.device.createBuffer({
            label: 'Ray tracing accumulation readback',
            size: bytesPerRow * height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        let mapped = false;
        try {
            const encoder = this.device.createCommandEncoder({ label: 'Ray tracing accumulation readback' });
            encoder.copyTextureToBuffer(
                { texture: textures[readIndex] },
                { buffer: readback, bytesPerRow, rowsPerImage: height },
                [width, height, 1],
            );
            this.device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            mapped = true;
            const source = new Uint16Array(readback.getMappedRange());
            const sourceRowStride = bytesPerRow / 2;
            const data = new Float32Array(width * height * 4);
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const sourceOffset = y * sourceRowStride + x * 4;
                    const targetOffset = (y * width + x) * 4;
                    for (let channel = 0; channel < 4; channel += 1) {
                        data[targetOffset + channel] = float16ToNumber(source[sourceOffset + channel]);
                    }
                }
            }
            return { width, height, spp: this.sampleCount, data };
        } finally {
            if (mapped) readback.unmap();
            readback.destroy();
        }
    }

    getStats() {
        return {
            backend: 'webgpu',
            renderMode: 'raytrace-gpu',
            drawableKind: this.drawable ? 'raytrace' : 'none',
            spp: this.sampleCount,
            triangleCount: this.packedScene?.metadata?.triangleCount || 0,
            instanceCount: this.packedScene?.metadata?.instanceCount || 0,
            diagnostics: { ...this.diagnostics },
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
