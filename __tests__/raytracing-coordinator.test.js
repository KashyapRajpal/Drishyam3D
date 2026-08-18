import { createRayTracingCoordinator } from '../scripts/engine/raytracing-coordinator.js';

function canvas() {
  return { getContext: jest.fn() };
}

describe('ray tracing coordinator', () => {
  const OriginalWorker = global.Worker;
  beforeEach(() => { global.Worker = function Worker() {}; });
  afterAll(() => { global.Worker = OriginalWorker; });

  test('switches one presentation loop and retains the CPU scene', async () => {
    const raster = {
      scene: { pause: jest.fn(), resume: jest.fn() },
      getStats: jest.fn(() => ({ backend: 'webgl' })),
    };
    const cpu = {
      loadCornellBox: jest.fn(() => ({ name: 'Cornell' })),
      resume: jest.fn(), pause: jest.fn(), destroy: jest.fn(),
      getStats: jest.fn(() => ({ backend: 'cpu', spp: 3 })),
    };
    const modes = [];
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(), cpuFactory: jest.fn(async () => cpu), onModeChange: (mode) => modes.push(mode),
    });
    coordinator.setRasterEngine(raster);
    await coordinator.loadCornellBox();
    await coordinator.setRenderMode('raytrace-cpu');
    expect(raster.scene.pause).toHaveBeenCalledTimes(1);
    expect(cpu.resume).toHaveBeenCalledTimes(1);
    expect(coordinator.getStats()).toEqual({ backend: 'cpu', spp: 3 });
    await coordinator.setRenderMode('raster');
    expect(cpu.pause).toHaveBeenCalledTimes(1);
    expect(raster.scene.resume).toHaveBeenCalledTimes(1);
    expect(cpu.loadCornellBox).toHaveBeenCalledTimes(1);
    expect(modes).toEqual(['raytrace-cpu', 'raster']);
  });

  test('rejects unsupported modes and destroys CPU once', async () => {
    const cpu = { loadCornellBox: jest.fn(), destroy: jest.fn() };
    const coordinator = createRayTracingCoordinator({ cpuCanvas: canvas(), cpuFactory: async () => cpu });
    await expect(coordinator.setRenderMode('raytrace-gpu')).rejects.toMatchObject({ code: 'UNSUPPORTED_RENDER_MODE' });
    await coordinator.loadCornellBox();
    coordinator.destroy();
    coordinator.destroy();
    expect(cpu.destroy).toHaveBeenCalledTimes(1);
  });

  test('switches between retained GPU Cornell, CPU Cornell, and raster loops', async () => {
    const raster = {
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({ 'raytrace-gpu': { available: true } })),
      loadCornellBox: jest.fn(() => ({ kind: 'raytrace' })),
      setRenderMode: jest.fn(async () => {}),
      setRayTracingSettings: jest.fn(),
      resetAccumulation: jest.fn(),
      getStats: jest.fn(() => ({ backend: 'webgpu', renderMode: 'raytrace-gpu', spp: 4 })),
    };
    const cpu = {
      loadCornellBox: jest.fn(), resume: jest.fn(), pause: jest.fn(), destroy: jest.fn(),
    };
    const modes = [];
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(), cpuFactory: async () => cpu, onModeChange: (value) => modes.push(value),
    });
    coordinator.setRasterEngine(raster);
    await coordinator.loadCornellBox('raytrace-gpu');
    await coordinator.setRenderMode('raytrace-gpu');
    expect(raster.loadCornellBox).toHaveBeenCalledTimes(1);
    expect(raster.setRenderMode).toHaveBeenCalledWith('raytrace-gpu');
    expect(coordinator.getStats()).toMatchObject({ renderMode: 'raytrace-gpu', spp: 4 });
    coordinator.setRayTracingSettings({ samplesPerFrame: 2 });
    coordinator.resetAccumulation();
    expect(raster.setRayTracingSettings).toHaveBeenCalledWith({ samplesPerFrame: 2 });
    expect(raster.resetAccumulation).toHaveBeenCalled();

    await coordinator.setRenderMode('raytrace-cpu');
    expect(raster.setRenderMode).toHaveBeenCalledWith('raster');
    expect(raster.scene.pause).toHaveBeenCalled();
    expect(cpu.resume).toHaveBeenCalled();
    await coordinator.setRenderMode('raster');
    expect(raster.scene.resume).toHaveBeenCalled();
    expect(modes).toEqual(['raytrace-gpu', 'raytrace-cpu', 'raster']);
  });
});
