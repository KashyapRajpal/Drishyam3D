import fs from 'fs';
import path from 'path';
import { buildAccelerationStructures } from '../scripts/engine/raytracing/acceleration/acceleration-structure.js';
import { createCornellBoxScene } from '../scripts/engine/raytracing/core/cornell-box.js';
import { FRAME_UNIFORM_OFFSETS } from '../scripts/engine/raytracing/gpu/gpu-ray-layout.js';
import { RayTraceRenderer } from '../scripts/engine/renderers/raytrace-renderer.js';

const shaderSource = fs.readFileSync(path.join(process.cwd(), 'assets/shaders/raytrace.wgsl'), 'utf8');

function mockDevice() {
  return {
    limits: {
      maxStorageBuffersPerShaderStage: 8,
      maxStorageBufferBindingSize: 1 << 28,
      maxBufferSize: 1 << 28,
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
    createShaderModule: jest.fn((desc) => ({ desc })),
    createComputePipeline: jest.fn((desc) => ({ desc })),
    createRenderPipeline: jest.fn((desc) => ({ desc })),
  };
}

function mockEncoder(events = []) {
  const computePass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    dispatchWorkgroups: jest.fn(),
    end: jest.fn(() => events.push('compute-end')),
  };
  const renderPass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    draw: jest.fn(),
    end: jest.fn(() => events.push('render-end')),
  };
  return {
    encoder: {
      beginComputePass: jest.fn(() => { events.push('compute-begin'); return computePass; }),
      beginRenderPass: jest.fn(() => { events.push('render-begin'); return renderPass; }),
    },
    computePass,
    renderPass,
  };
}

function rayDrawable() {
  const scene = createCornellBoxScene();
  return { kind: 'raytrace', scene, acceleration: buildAccelerationStructures(scene) };
}

function camera() {
  return {
    eye: [0, 1, 3.2],
    target: [0, 1, 0],
    up: [0, 1, 0],
    getPosition() { return this.eye; },
  };
}

function frame(width, height, cameraValue = camera(), events = []) {
  const passes = mockEncoder(events);
  return {
    ...passes,
    frame: {
      device: null,
      encoder: passes.encoder,
      targetView: { target: true },
      camera: cameraValue,
      width,
      height,
    },
  };
}

describe('RayTraceRenderer', () => {
  beforeEach(() => {
    global.GPUBufferUsage = {
      MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080,
    };
    global.GPUTextureUsage = {
      COPY_SRC: 0x01, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10,
    };
    global.GPUShaderStage = { FRAGMENT: 0x02, COMPUTE: 0x04 };
  });

  test('prepares explicit pipelines and packed Cornell scene resources', () => {
    const device = mockDevice();
    const renderer = new RayTraceRenderer(device, 'bgra8unorm');
    renderer.init();
    renderer.setShader(shaderSource);
    renderer.prepare(rayDrawable());
    expect(device.createShaderModule).toHaveBeenCalledTimes(2);
    expect(device.createShaderModule.mock.calls[0][0].code).toContain('fn cs_raytrace');
    expect(device.createShaderModule.mock.calls[1][0].code).toContain('fn fs_display');
    expect(renderer.tracePipeline.desc.layout).toBe(renderer.layouts.tracePipeline);
    expect(renderer.displayPipeline.desc.layout).toBe(renderer.layouts.displayPipeline);
    expect(renderer.sceneResources.metadata).toMatchObject({ triangleCount: 14, instanceCount: 8 });
    expect(renderer.sceneBindGroup.desc.entries).toHaveLength(8);
  });

  test('records compute then display with ceil-divided dispatch dimensions', () => {
    const device = mockDevice();
    const renderer = new RayTraceRenderer(device, 'bgra8unorm');
    const drawable = rayDrawable();
    renderer.setShader(shaderSource);
    renderer.prepare(drawable);
    const events = [];
    const recorded = frame(17, 9, camera(), events);
    recorded.frame.device = device;
    renderer.record(recorded.frame, drawable);
    expect(events).toEqual(['compute-begin', 'compute-end', 'render-begin', 'render-end']);
    expect(recorded.computePass.dispatchWorkgroups).toHaveBeenCalledWith(3, 2);
    expect(recorded.computePass.setBindGroup).toHaveBeenNthCalledWith(1, 0, renderer.sceneBindGroup);
    expect(recorded.renderPass.draw).toHaveBeenCalledWith(3);
    expect(renderer.getStats()).toMatchObject({ spp: 1, triangleCount: 14, instanceCount: 8 });

    const uniformWrite = device.queue.writeBuffer.mock.calls.find(([buffer]) => buffer === renderer.frameResources.uniformBuffer);
    const uniforms = new DataView(uniformWrite[2]);
    expect(uniforms.getUint32(FRAME_UNIFORM_OFFSETS.dimensions + 8, true)).toBe(0);
    expect(uniforms.getUint32(FRAME_UNIFORM_OFFSETS.renderSettings, true)).toBe(1);
  });

  test('resizes accumulation targets and resets samples on camera/settings changes', () => {
    const device = mockDevice();
    const renderer = new RayTraceRenderer(device, 'bgra8unorm');
    const drawable = rayDrawable();
    renderer.setShader(shaderSource);
    renderer.prepare(drawable);

    const first = frame(16, 8);
    first.frame.device = device;
    renderer.record(first.frame, drawable);
    renderer.record(first.frame, drawable);
    expect(renderer.getStats().spp).toBe(2);
    const firstTextures = [...renderer.accumulationTargets.textures];

    const movedCamera = camera();
    movedCamera.eye = [0.1, 1, 3.2];
    const moved = frame(16, 8, movedCamera);
    moved.frame.device = device;
    renderer.record(moved.frame, drawable);
    expect(renderer.getStats().spp).toBe(1);

    const resized = frame(32, 20, movedCamera);
    resized.frame.device = device;
    renderer.record(resized.frame, drawable);
    expect(renderer.getStats().spp).toBe(1);
    firstTextures.forEach((texture) => expect(texture.destroy).toHaveBeenCalledTimes(1));

    renderer.setSettings({ exposure: 1.5 });
    expect(renderer.getStats().spp).toBe(0);
    renderer.record(resized.frame, drawable);
    const frameWrites = device.queue.writeBuffer.mock.calls.filter(([buffer]) => buffer === renderer.frameResources.uniformBuffer);
    expect(new DataView(frameWrites.at(-1)[2]).getUint32(FRAME_UNIFORM_OFFSETS.dimensions + 8, true)).toBe(0);
  });

  test('releases replaced scene buffers and destroys all owned resources once', () => {
    const device = mockDevice();
    const renderer = new RayTraceRenderer(device, 'bgra8unorm');
    const firstDrawable = rayDrawable();
    renderer.setShader(shaderSource);
    renderer.prepare(firstDrawable);
    const firstSceneBuffers = Object.values(renderer.sceneResources.buffers);
    const firstFrame = frame(8, 8);
    firstFrame.frame.device = device;
    renderer.record(firstFrame.frame, firstDrawable);

    const secondDrawable = rayDrawable();
    renderer.prepare(secondDrawable);
    firstSceneBuffers.forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledTimes(1));
    const owned = [
      ...Object.values(renderer.sceneResources.buffers),
      renderer.frameResources.uniformBuffer,
      renderer.frameResources.diagnosticsBuffer,
      renderer.frameResources.diagnosticsReadbackBuffer,
      renderer.frameResources.displayUniformBuffer,
      ...renderer.accumulationTargets.textures,
    ];
    renderer.destroy();
    renderer.destroy();
    owned.forEach((resource) => expect(resource.destroy).toHaveBeenCalledTimes(1));
  });

  test('shader mirrors packed layouts and contains primary, shadow, and display stages', () => {
    expect(shaderSource).toMatch(/struct Vertex[\s\S]*position\s*:\s*vec4<f32>[\s\S]*normal\s*:\s*vec4<f32>/);
    expect(shaderSource).toMatch(/struct BvhNode[\s\S]*leftFirst\s*:\s*u32[\s\S]*primitiveCount\s*:\s*u32/);
    expect(shaderSource).toContain('@group(0) @binding(7) var<storage, read_write> diagnostics');
    expect(shaderSource).toContain('@compute @workgroup_size(8, 8, 1)');
    expect(shaderSource).toContain('intersectScene(shadowRay, epsilon, distance - epsilon, true)');
    expect(shaderSource).toContain('fn fs_display');
  });
});
