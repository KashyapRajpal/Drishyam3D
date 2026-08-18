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
});
