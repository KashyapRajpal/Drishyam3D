import { buildAccelerationStructures } from '../scripts/engine/raytracing/acceleration/acceleration-structure.js';
import { createCornellBoxScene } from '../scripts/engine/raytracing/core/cornell-box.js';
import {
  ACCUMULATION_FORMAT,
  REQUIRED_STORAGE_BUFFERS_PER_STAGE,
  advanceAccumulationTargets,
  assertRayTracingDeviceSupport,
  clearGpuRayDiagnostics,
  createAccumulationTargets,
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
  recordAccumulationClear,
  resizeAccumulationTargets,
  uploadGpuRayTlasAndInstances,
} from '../scripts/engine/raytracing/gpu/gpu-ray-helpers.js';
import { packGpuScene } from '../scripts/engine/raytracing/gpu/gpu-scene-packer.js';

function mockDevice(limits = {}) {
  const device = {
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 1 << 28,
      maxBufferSize: 1 << 28,
      ...limits,
    },
    queue: { writeBuffer: jest.fn() },
    createBuffer: jest.fn((desc) => ({ desc, size: desc.size, destroy: jest.fn() })),
    createTexture: jest.fn((desc) => {
      const texture = { desc, destroy: jest.fn() };
      texture.createView = jest.fn(() => ({ texture }));
      return texture;
    }),
    createBindGroupLayout: jest.fn((desc) => ({ desc })),
    createPipelineLayout: jest.fn((desc) => ({ desc })),
    createBindGroup: jest.fn((desc) => ({ desc })),
  };
  return device;
}

function packedCornell() {
  const scene = createCornellBoxScene();
  return packGpuScene(scene, buildAccelerationStructures(scene));
}

describe('GPU ray resource helpers', () => {
  beforeEach(() => {
    global.GPUBufferUsage = {
      MAP_READ: 0x0001,
      COPY_SRC: 0x0004,
      COPY_DST: 0x0008,
      UNIFORM: 0x0040,
      STORAGE: 0x0080,
    };
    global.GPUTextureUsage = {
      COPY_SRC: 0x01, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10,
    };
    global.GPUShaderStage = { FRAGMENT: 0x02, COMPUTE: 0x04 };
  });

  test('rejects unsupported storage limits before allocating', () => {
    const device = mockDevice({ maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFERS_PER_STAGE - 1 });
    expect(() => createGpuRaySceneResources(device, packedCornell())).toThrow(/requires 7 storage buffers/);
    expect(device.createBuffer).not.toHaveBeenCalled();

    const smallDevice = mockDevice({ maxStorageBufferBindingSize: 64 });
    expect(() => assertRayTracingDeviceSupport(smallDevice, packedCornell())).toThrow(/storage-buffer binding/);
  });

  test('creates aligned storage buffers, uploads logical bytes, and allocates empty dummies', () => {
    const device = mockDevice();
    const packed = packedCornell();
    const resources = createGpuRaySceneResources(device, packed);
    expect(device.createBuffer).toHaveBeenCalledTimes(6);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(6);
    for (const buffer of Object.values(resources.buffers)) {
      expect(buffer.desc.size % 4).toBe(0);
      expect(buffer.desc.usage & GPUBufferUsage.STORAGE).toBeTruthy();
      expect(buffer.desc.usage & GPUBufferUsage.COPY_DST).toBeTruthy();
    }

    const emptyPacked = {
      buffers: Object.fromEntries(Object.keys(packed.buffers).map((name) => [name, new ArrayBuffer(0)])),
      metadata: { allocationByteLengths: packed.metadata.allocationByteLengths },
    };
    const emptyDevice = mockDevice();
    const emptyResources = createGpuRaySceneResources(emptyDevice, emptyPacked);
    expect(emptyDevice.queue.writeBuffer).not.toHaveBeenCalled();
    expect(Object.values(emptyResources.buffers).every((buffer) => buffer.size > 0)).toBe(true);
  });

  test('partial updates write only TLAS node/leaf prefixes and instances', () => {
    const device = mockDevice();
    const packed = packedCornell();
    const resources = createGpuRaySceneResources(device, packed);
    device.queue.writeBuffer.mockClear();
    const ranges = { nodeByteLength: 96, leafByteLength: 32, instanceByteLength: packed.buffers.instances.byteLength };
    uploadGpuRayTlasAndInstances(device, resources, packed, ranges);
    expect(device.queue.writeBuffer.mock.calls).toEqual([
      [resources.buffers.bvhNodes, 0, packed.buffers.bvhNodes, 0, 96],
      [resources.buffers.bvhLeafReferences, 0, packed.buffers.bvhLeafReferences, 0, 32],
      [resources.buffers.instances, 0, packed.buffers.instances, 0, packed.buffers.instances.byteLength],
    ]);
    expect(device.queue.writeBuffer.mock.calls.some(([buffer]) => buffer === resources.buffers.vertices)).toBe(false);
    expect(device.queue.writeBuffer.mock.calls.some(([buffer]) => buffer === resources.buffers.triangles)).toBe(false);
  });

  test('creates frame buffers with the required usage flags and clears diagnostics', () => {
    const device = mockDevice();
    const resources = createGpuRayFrameResources(device);
    expect(resources.uniformBuffer.desc.usage).toBe(GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    expect(resources.diagnosticsBuffer.desc.usage & GPUBufferUsage.STORAGE).toBeTruthy();
    expect(resources.diagnosticsBuffer.desc.usage & GPUBufferUsage.COPY_SRC).toBeTruthy();
    expect(resources.diagnosticsReadbackBuffer.desc.usage).toBe(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    clearGpuRayDiagnostics(device, resources);
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(resources.diagnosticsBuffer, 0, expect.any(Uint32Array));
  });

  test('ping-pongs, records a two-target clear, and replaces textures only on resize', () => {
    const device = mockDevice();
    const first = createAccumulationTargets(device, 320, 200);
    expect(first.textures[0].desc).toMatchObject({ size: [320, 200, 1], format: ACCUMULATION_FORMAT });
    expect(first.textures[0].desc.usage & GPUTextureUsage.STORAGE_BINDING).toBeTruthy();
    expect(first.textures[0].desc.usage & GPUTextureUsage.COPY_SRC).toBeTruthy();
    expect(getAccumulationPair(first)).toMatchObject({ readIndex: 0, writeIndex: 1 });
    expect(advanceAccumulationTargets(first)).toBe(1);

    const pass = { end: jest.fn() };
    const encoder = { beginRenderPass: jest.fn(() => pass) };
    recordAccumulationClear(encoder, first);
    expect(encoder.beginRenderPass.mock.calls[0][0].colorAttachments).toHaveLength(2);
    expect(pass.end).toHaveBeenCalledTimes(1);
    expect(first.readIndex).toBe(0);

    expect(resizeAccumulationTargets(device, first, 320, 200)).toBe(first);
    const second = resizeAccumulationTargets(device, first, 640, 400);
    first.textures.forEach((texture) => expect(texture.destroy).toHaveBeenCalledTimes(1));
    expect(second).not.toBe(first);
  });

  test('creates explicit layouts and bind groups with the documented resources', () => {
    const device = mockDevice();
    const layouts = createGpuRayBindGroupLayouts(device);
    expect(layouts.scene.desc.entries).toHaveLength(8);
    expect(layouts.scene.desc.entries[7]).toMatchObject({ binding: 7, buffer: { type: 'storage' } });
    expect(layouts.accumulation.desc.entries[1].storageTexture).toEqual({ access: 'write-only', format: ACCUMULATION_FORMAT });
    expect(layouts.tracePipeline.desc.bindGroupLayouts).toEqual([layouts.scene, layouts.accumulation]);

    const packed = packedCornell();
    const sceneResources = createGpuRaySceneResources(device, packed);
    const frameResources = createGpuRayFrameResources(device);
    const targets = createAccumulationTargets(device, 64, 32);
    const sceneGroup = createGpuRaySceneBindGroup(device, layouts.scene, sceneResources, frameResources);
    const accumulationGroups = createGpuRayAccumulationBindGroups(device, layouts.accumulation, targets);
    const displayGroups = createGpuRayDisplayBindGroups(device, layouts.display, targets, frameResources);
    expect(sceneGroup.desc.entries.map((entry) => entry.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sceneGroup.desc.entries[3].resource.buffer).toBe(sceneResources.buffers.bvhNodes);
    expect(accumulationGroups[0].desc.entries[0].resource).toBe(targets.views[0]);
    expect(accumulationGroups[0].desc.entries[1].resource).toBe(targets.views[1]);
    expect(displayGroups[1].desc.entries[0].resource).toBe(targets.views[1]);
  });

  test('resource cleanup is idempotent', () => {
    const device = mockDevice();
    const sceneResources = createGpuRaySceneResources(device, packedCornell());
    const frameResources = createGpuRayFrameResources(device);
    const targets = createAccumulationTargets(device, 16, 16);
    destroyGpuRaySceneResources(sceneResources);
    destroyGpuRaySceneResources(sceneResources);
    destroyGpuRayFrameResources(frameResources);
    destroyGpuRayFrameResources(frameResources);
    destroyAccumulationTargets(targets);
    destroyAccumulationTargets(targets);
    [...Object.values(sceneResources.buffers), frameResources.uniformBuffer, frameResources.diagnosticsBuffer,
      frameResources.diagnosticsReadbackBuffer, frameResources.displayUniformBuffer, ...targets.textures]
      .forEach((resource) => expect(resource.destroy).toHaveBeenCalledTimes(1));
  });
});
