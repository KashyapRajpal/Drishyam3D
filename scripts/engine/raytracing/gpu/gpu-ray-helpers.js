import { DIAGNOSTICS_SIZE, FRAME_UNIFORM_SIZE } from './gpu-ray-layout.js';

export const REQUIRED_STORAGE_BUFFERS_PER_STAGE = 7;
export const ACCUMULATION_FORMAT = 'rgba16float';
export const DISPLAY_UNIFORM_SIZE = 16;

const SCENE_BUFFER_NAMES = Object.freeze([
    'vertices',
    'triangles',
    'bvhNodes',
    'bvhLeafReferences',
    'instances',
    'materials',
]);
const destroyedGpuResources = new WeakSet();

function alignTo4(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('GPU buffer size must be a non-negative safe integer.');
    return Math.max(4, Math.ceil(value / 4) * 4);
}

function requirePositiveDimension(value, label) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
}

function resolveLayout(layoutOrPipeline, groupIndex) {
    if (layoutOrPipeline?.getBindGroupLayout) return layoutOrPipeline.getBindGroupLayout(groupIndex);
    if (!layoutOrPipeline) throw new Error('A bind-group layout or pipeline is required.');
    return layoutOrPipeline;
}

function destroyOnce(resource) {
    if (!resource || destroyedGpuResources.has(resource)) return;
    resource.destroy?.();
    destroyedGpuResources.add(resource);
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size: alignTo4(size), usage });
}

function uploadIfPresent(device, buffer, data) {
    if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
}

/** Throws before allocation when the device cannot support the ray bind-group contract. */
export function assertRayTracingDeviceSupport(device, packed = null) {
    if (!device?.limits) throw new Error('Ray tracing requires a WebGPU device with reported limits.');
    const storageBufferLimit = device.limits.maxStorageBuffersPerShaderStage;
    if (!Number.isFinite(storageBufferLimit) || storageBufferLimit < REQUIRED_STORAGE_BUFFERS_PER_STAGE) {
        throw new Error(`Ray tracing requires ${REQUIRED_STORAGE_BUFFERS_PER_STAGE} storage buffers per shader stage; device supports ${storageBufferLimit ?? 'unknown'}.`);
    }

    const allocationSizes = packed ? Object.values(packed.metadata?.allocationByteLengths || {}) : [];
    const largestStorageBufferSize = allocationSizes.length ? Math.max(...allocationSizes) : 0;
    for (const [limitName, label] of [
        ['maxStorageBufferBindingSize', 'storage-buffer binding'],
        ['maxBufferSize', 'buffer allocation'],
    ]) {
        const limit = device.limits[limitName];
        if (Number.isFinite(limit) && largestStorageBufferSize > limit) {
            throw new Error(`Ray tracing ${label} needs ${largestStorageBufferSize} bytes; device limit is ${limit}.`);
        }
    }
    return { requiredStorageBuffers: REQUIRED_STORAGE_BUFFERS_PER_STAGE, largestStorageBufferSize };
}

/** Allocates and uploads the six packed scene storage buffers, including dummy records. */
export function createGpuRaySceneResources(device, packed) {
    assertRayTracingDeviceSupport(device, packed);
    if (!packed?.buffers || !packed?.metadata?.allocationByteLengths) {
        throw new Error('GPU scene resources require a packed ray scene.');
    }
    const buffers = {};
    try {
        for (const name of SCENE_BUFFER_NAMES) {
            const data = packed.buffers[name];
            const allocationSize = packed.metadata.allocationByteLengths[name];
            if (!(data instanceof ArrayBuffer) || !Number.isSafeInteger(allocationSize)) {
                throw new Error(`Packed ray scene is missing ${name} buffer metadata.`);
            }
            const buffer = createBuffer(
                device,
                `Ray tracing ${name}`,
                allocationSize,
                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            );
            buffers[name] = buffer;
            uploadIfPresent(device, buffer, data);
        }
    } catch (error) {
        Object.values(buffers).forEach(destroyOnce);
        throw error;
    }
    return { buffers, metadata: packed.metadata, destroyed: false };
}

/** Uploads only the mutable TLAS prefixes and instance records. */
export function uploadGpuRayTlasAndInstances(device, resources, packed, ranges) {
    if (resources?.destroyed) throw new Error('Cannot update destroyed GPU ray scene resources.');
    for (const [name, byteLength] of [
        ['bvhNodes', ranges?.nodeByteLength],
        ['bvhLeafReferences', ranges?.leafByteLength],
        ['instances', ranges?.instanceByteLength],
    ]) {
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > packed.buffers[name].byteLength) {
            throw new Error(`Invalid ${name} upload byte length.`);
        }
        if (byteLength > resources.buffers[name].size) throw new Error(`${name} update exceeds its GPU allocation.`);
        if (byteLength > 0) device.queue.writeBuffer(resources.buffers[name], 0, packed.buffers[name], 0, byteLength);
    }
}

export function destroyGpuRaySceneResources(resources) {
    if (!resources || resources.destroyed) return;
    Object.values(resources.buffers || {}).forEach(destroyOnce);
    resources.destroyed = true;
}

/** Creates per-frame uniforms, diagnostics, readback, and display settings buffers. */
export function createGpuRayFrameResources(device) {
    const resources = {};
    try {
        resources.uniformBuffer = createBuffer(
            device,
            'Ray tracing frame uniforms',
            FRAME_UNIFORM_SIZE,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        resources.diagnosticsBuffer = createBuffer(
            device,
            'Ray tracing diagnostics',
            DIAGNOSTICS_SIZE,
            GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        );
        resources.diagnosticsReadbackBuffer = createBuffer(
            device,
            'Ray tracing diagnostics readback',
            DIAGNOSTICS_SIZE,
            GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        );
        resources.displayUniformBuffer = createBuffer(
            device,
            'Ray tracing display uniforms',
            DISPLAY_UNIFORM_SIZE,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        resources.destroyed = false;
        return resources;
    } catch (error) {
        Object.values(resources).forEach(destroyOnce);
        throw error;
    }
}

export function uploadGpuRayFrameUniforms(device, resources, packedUniforms) {
    if (resources?.destroyed) throw new Error('Cannot update destroyed GPU ray frame resources.');
    if (!(packedUniforms instanceof ArrayBuffer) || packedUniforms.byteLength !== FRAME_UNIFORM_SIZE) {
        throw new Error(`Frame uniforms must be a ${FRAME_UNIFORM_SIZE}-byte ArrayBuffer.`);
    }
    device.queue.writeBuffer(resources.uniformBuffer, 0, packedUniforms);
}

export function clearGpuRayDiagnostics(device, resources) {
    if (resources?.destroyed) return;
    device.queue.writeBuffer(resources.diagnosticsBuffer, 0, new Uint32Array(DIAGNOSTICS_SIZE / 4));
}

export function destroyGpuRayFrameResources(resources) {
    if (!resources || resources.destroyed) return;
    destroyOnce(resources.uniformBuffer);
    destroyOnce(resources.diagnosticsBuffer);
    destroyOnce(resources.diagnosticsReadbackBuffer);
    destroyOnce(resources.displayUniformBuffer);
    resources.destroyed = true;
}

export function createAccumulationTargets(device, width, height, format = ACCUMULATION_FORMAT) {
    requirePositiveDimension(width, 'Accumulation width');
    requirePositiveDimension(height, 'Accumulation height');
    const textures = [];
    try {
        for (let index = 0; index < 2; index += 1) {
            textures.push(device.createTexture({
                label: `Ray tracing accumulation ${index}`,
                size: [width, height, 1],
                format,
                usage: GPUTextureUsage.TEXTURE_BINDING
                    | GPUTextureUsage.STORAGE_BINDING
                    | GPUTextureUsage.RENDER_ATTACHMENT,
            }));
        }
    } catch (error) {
        textures.forEach(destroyOnce);
        throw error;
    }
    return {
        width,
        height,
        format,
        textures,
        views: textures.map((texture) => texture.createView()),
        readIndex: 0,
        destroyed: false,
    };
}

export function resizeAccumulationTargets(device, current, width, height, format = ACCUMULATION_FORMAT) {
    if (current && !current.destroyed && current.width === width && current.height === height && current.format === format) {
        return current;
    }
    destroyAccumulationTargets(current);
    return createAccumulationTargets(device, width, height, format);
}

export function getAccumulationPair(targets) {
    if (!targets || targets.destroyed) throw new Error('Accumulation targets are unavailable.');
    const writeIndex = 1 - targets.readIndex;
    return {
        readIndex: targets.readIndex,
        writeIndex,
        previousTexture: targets.textures[targets.readIndex],
        previousView: targets.views[targets.readIndex],
        nextTexture: targets.textures[writeIndex],
        nextView: targets.views[writeIndex],
    };
}

export function advanceAccumulationTargets(targets) {
    const pair = getAccumulationPair(targets);
    targets.readIndex = pair.writeIndex;
    return targets.readIndex;
}

/** Clears both ping-pong textures without requiring a shader pipeline. */
export function recordAccumulationClear(encoder, targets, clearValue = { r: 0, g: 0, b: 0, a: 0 }) {
    if (!encoder?.beginRenderPass) throw new Error('Accumulation clear requires a command encoder.');
    const pass = encoder.beginRenderPass({
        label: 'Clear ray tracing accumulation',
        colorAttachments: targets.views.map((view) => ({
            view,
            clearValue,
            loadOp: 'clear',
            storeOp: 'store',
        })),
    });
    pass.end();
    targets.readIndex = 0;
}

export function destroyAccumulationTargets(targets) {
    if (!targets || targets.destroyed) return;
    targets.textures.forEach(destroyOnce);
    targets.destroyed = true;
}

/** Creates the stable explicit layouts shared by ray tracing pipelines and bind groups. */
export function createGpuRayBindGroupLayouts(device) {
    const scene = device.createBindGroupLayout({
        label: 'Ray tracing scene layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ...[1, 2, 3, 4, 5, 6].map((binding) => ({
                binding,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' },
            })),
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
    });
    const accumulation = device.createBindGroupLayout({
        label: 'Ray tracing accumulation layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: { access: 'write-only', format: ACCUMULATION_FORMAT },
            },
        ],
    });
    const display = device.createBindGroupLayout({
        label: 'Ray tracing display layout',
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
    });
    return {
        scene,
        accumulation,
        display,
        tracePipeline: device.createPipelineLayout({ label: 'Ray tracing pipeline layout', bindGroupLayouts: [scene, accumulation] }),
        displayPipeline: device.createPipelineLayout({ label: 'Ray tracing display pipeline layout', bindGroupLayouts: [display] }),
    };
}

export function createGpuRaySceneBindGroup(device, layoutOrPipeline, sceneResources, frameResources) {
    return device.createBindGroup({
        label: 'Ray tracing scene bind group',
        layout: resolveLayout(layoutOrPipeline, 0),
        entries: [
            { binding: 0, resource: { buffer: frameResources.uniformBuffer } },
            ...SCENE_BUFFER_NAMES.map((name, index) => ({
                binding: index + 1,
                resource: { buffer: sceneResources.buffers[name] },
            })),
            { binding: 7, resource: { buffer: frameResources.diagnosticsBuffer } },
        ],
    });
}

export function createGpuRayAccumulationBindGroups(device, layoutOrPipeline, targets) {
    const layout = resolveLayout(layoutOrPipeline, 1);
    return [0, 1].map((readIndex) => device.createBindGroup({
        label: `Ray tracing accumulation bind group ${readIndex}`,
        layout,
        entries: [
            { binding: 0, resource: targets.views[readIndex] },
            { binding: 1, resource: targets.views[1 - readIndex] },
        ],
    }));
}

export function createGpuRayDisplayBindGroups(device, layoutOrPipeline, targets, frameResources) {
    const layout = resolveLayout(layoutOrPipeline, 0);
    return targets.views.map((view, index) => device.createBindGroup({
        label: `Ray tracing display bind group ${index}`,
        layout,
        entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: { buffer: frameResources.displayUniformBuffer } },
        ],
    }));
}
