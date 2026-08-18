const mockRendererInstances = { mesh: [], splat: [], tile: [], ray: [], hybrid: [] };

function mockRenderer(kind) {
  const renderer = {
    kind,
    init: jest.fn(),
    prepare: jest.fn(),
    record: jest.fn(),
    releaseDrawable: jest.fn(),
    destroy: jest.fn(),
    setPipeline: jest.fn(),
    setShaders: jest.fn(),
    setShader: jest.fn(),
    setShadowShader: jest.fn(),
    setReduction: jest.fn(),
    setSort: jest.fn(),
    setDebugMode: jest.fn(),
    setMaxShDegree: jest.fn(),
    setSettings: jest.fn(),
    resetAccumulation: jest.fn(),
    updateTlasAndInstances: jest.fn(),
    readAccumulation: jest.fn(),
    readDiagnostics: jest.fn(),
    getStats: jest.fn(() => ({ backend: 'webgpu', renderMode: 'raytrace-gpu', spp: 7 })),
    getReductionInfo: jest.fn(() => ({ mode: 'none', sort: 'bitonic', visible: -1 })),
  };
  mockRendererInstances[kind].push(renderer);
  return renderer;
}

jest.mock('../scripts/engine/renderers/mesh-renderer.js', () => ({
  MeshRenderer: jest.fn(() => mockRenderer('mesh')),
}));
jest.mock('../scripts/engine/renderers/splat-renderer.js', () => ({
  SplatRenderer: jest.fn(() => mockRenderer('splat')),
}));
jest.mock('../scripts/engine/renderers/splat-tile-renderer.js', () => ({
  SplatTileRenderer: jest.fn(() => mockRenderer('tile')),
}));
jest.mock('../scripts/engine/renderers/raytrace-renderer.js', () => ({
  RayTraceRenderer: jest.fn(() => mockRenderer('ray')),
}));
jest.mock('../scripts/engine/renderers/hybrid-shadow-renderer.js', () => ({
  HybridShadowRenderer: jest.fn(() => mockRenderer('hybrid')),
}));

const mockTimers = [];
jest.mock('../scripts/engine/gpu-timer.js', () => ({
  GpuTimer: jest.fn(() => {
    const timer = {
      beginFrame: jest.fn(),
      resolve: jest.fn(),
      readback: jest.fn(),
      getDurations: jest.fn(() => ({ trace: 1 })),
      destroy: jest.fn(),
    };
    mockTimers.push(timer);
    return timer;
  }),
}));

import { createWebGPUScene } from '../scripts/engine/webgpu-scene.js';

function setup() {
  const encoder = { finish: jest.fn(() => ({ done: true })) };
  const device = {
    createCommandEncoder: jest.fn(() => encoder),
    queue: { submit: jest.fn(), onSubmittedWorkDone: jest.fn(async () => {}) },
  };
  const context = {
    configure: jest.fn(),
    getCurrentTexture: jest.fn(() => ({ createView: jest.fn(() => ({ target: true })) })),
  };
  const canvas = { clientWidth: 80, clientHeight: 60, width: 80, height: 60 };
  const camera = {
    zoom: 5,
    updateViewMatrix: jest.fn(),
    getViewMatrix: jest.fn(() => new Float32Array(16)),
  };
  const scene = createWebGPUScene(device, context, 'bgra8unorm', canvas, camera);
  return {
    scene,
    device,
    encoder,
    mesh: mockRendererInstances.mesh.at(-1),
    splat: mockRendererInstances.splat.at(-1),
    tile: mockRendererInstances.tile.at(-1),
    ray: mockRendererInstances.ray.at(-1),
    hybrid: mockRendererInstances.hybrid.at(-1),
  };
}

describe('WebGPU scene ray tracing registry', () => {
  let scheduled;

  beforeEach(() => {
    scheduled = [];
    global.requestAnimationFrame = jest.fn((callback) => { scheduled.push(callback); return scheduled.length; });
  });

  test('retains separate raster/ray drawables while switching modes', () => {
    const { scene, mesh, ray } = setup();
    const rasterDrawable = { kind: 'mesh', vertexCount: 6, bounds: { radius: 1 } };
    const rayDrawable = { kind: 'raytrace', bounds: { radius: 2 } };
    scene.loadGeometry(rasterDrawable);
    scene.loadRayGeometry(rayDrawable);
    scene.setRayTracingShader('ray wgsl');
    expect(scene.getDrawable()).toBe(rasterDrawable);

    scene.setRenderMode('raytrace-gpu');
    expect(scene.getDrawable()).toBe(rayDrawable);
    expect(ray.prepare).toHaveBeenCalledWith(rayDrawable);
    expect(mesh.releaseDrawable).not.toHaveBeenCalled();

    scene.setRenderMode('raster');
    expect(scene.getDrawable()).toBe(rasterDrawable);
    expect(mesh.prepare).toHaveBeenCalledWith(rasterDrawable);
    expect(ray.releaseDrawable).not.toHaveBeenCalled();
  });

  test('dispatches GPU ray frames without advancing user-script animation', () => {
    const { scene, device, mesh, ray } = setup();
    const update = jest.fn();
    scene.updateUserScript({ init: jest.fn(), update });
    const rasterDrawable = { kind: 'mesh', vertexCount: 6, bounds: { radius: 1 } };
    const rayDrawable = { kind: 'raytrace', bounds: { radius: 2 } };
    scene.loadGeometry(rasterDrawable);
    scene.loadRayGeometry(rayDrawable);
    scene.setRayTracingShader('ray wgsl');
    scene.setRenderMode('raytrace-gpu');
    scene.start();

    scheduled.shift()(16);
    expect(ray.record).toHaveBeenCalledWith(expect.objectContaining({ width: 80, height: 60 }), rayDrawable);
    expect(update).not.toHaveBeenCalled();
    expect(device.queue.submit).toHaveBeenCalled();

    scene.setRenderMode('raster');
    scheduled.shift()(32);
    expect(mesh.record).toHaveBeenCalledWith(expect.objectContaining({ width: 80, height: 60 }), rasterDrawable);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('rejects unavailable/unknown modes with explicit capability errors', () => {
    const { scene } = setup();
    expect(() => scene.setRenderMode('raytrace-gpu')).toThrow(/shader is unavailable/);
    scene.setRayTracingShader('ray wgsl');
    expect(() => scene.setRenderMode('raytrace-gpu')).toThrow(/No ray-traceable scene/);
    expect(() => scene.setRenderMode('hybrid-shadows')).toThrow(/shaders are unavailable/);
    try {
      scene.setRenderMode('unknown-mode');
    } catch (error) {
      expect(error.code).toBe('UNSUPPORTED_RENDER_MODE');
    }
  });

  test('dispatches hybrid mesh frames with animation and requires a ray sidecar', () => {
    const { scene, hybrid } = setup();
    const update = jest.fn();
    scene.updateUserScript({ init: jest.fn(), update });
    scene.setHybridShaders('gbuffer wgsl', 'composite wgsl');
    scene.setHybridShadowShader('shadow wgsl');
    scene.loadGeometry({ kind: 'mesh', vertexCount: 3 });
    expect(() => scene.setRenderMode('hybrid-shadows')).toThrow(/ray-traceable mesh sidecar/);

    const drawable = {
      kind: 'mesh', vertexCount: 6, bounds: { radius: 1 }, rayTracing: { preparedRayScene: {} },
    };
    scene.loadGeometry(drawable);
    scene.setRenderMode('hybrid-shadows');
    scene.start();
    scheduled.shift()(16);
    expect(hybrid.prepare).toHaveBeenCalledWith(drawable);
    expect(hybrid.record).toHaveBeenCalledWith(expect.objectContaining({ width: 80, height: 60 }), drawable);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('routes settings, partial TLAS updates, stats, and idempotent cleanup', () => {
    const { scene, mesh, splat, tile, ray, hybrid } = setup();
    const rasterDrawable = { kind: 'mesh', vertexCount: 6 };
    const rayDrawable = { kind: 'raytrace' };
    scene.loadGeometry(rasterDrawable);
    scene.loadRayGeometry(rayDrawable);
    scene.setRayTracingShader('ray wgsl');
    scene.setRayTracingSettings({ samplesPerFrame: 2 });
    scene.resetRayAccumulation();
    const packed = { buffers: true };
    const ranges = { nodeByteLength: 32 };
    scene.updateRayTlasAndInstances(rayDrawable, packed, ranges);
    expect(ray.setSettings).toHaveBeenCalledWith({ samplesPerFrame: 2 });
    expect(ray.resetAccumulation).toHaveBeenCalled();
    expect(ray.updateTlasAndInstances).toHaveBeenCalledWith(rayDrawable, packed, ranges);

    scene.setRenderMode('raytrace-gpu');
    expect(scene.getStats()).toMatchObject({ backend: 'webgpu', renderMode: 'raytrace-gpu', spp: 7, passMs: { trace: 1 } });
    scene.destroy();
    scene.destroy();
    expect(mesh.destroy).toHaveBeenCalledTimes(1);
    expect(splat.destroy).toHaveBeenCalledTimes(1);
    expect(tile.destroy).toHaveBeenCalledTimes(1);
    expect(ray.destroy).toHaveBeenCalledTimes(1);
    expect(hybrid.destroy).toHaveBeenCalledTimes(1);
    expect(ray.releaseDrawable).toHaveBeenCalledTimes(1);
  });
});
