import { initCpuRayEngine } from '../scripts/engine/cpu-ray-facade.js';

function mockCanvas() {
  const context = {
    putImageData: jest.fn(),
    createImageData: jest.fn((width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })),
  };
  return {
    clientWidth: 320, clientHeight: 240, width: 0, height: 0,
    parentElement: null,
    getContext: jest.fn(() => context),
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
    context,
  };
}

describe('CPU ray facade', () => {
  test('requires the environment-specific worker factory explicitly', async () => {
    await expect(initCpuRayEngine({ canvas: mockCanvas() })).rejects.toThrow(
      'CPU ray engine requires a workerFactory supplied by the browser entry point.',
    );
  });

  test('loads Cornell, presents tiles, resizes, and destroys idempotently', async () => {
    const canvas = mockCanvas();
    let callbacks;
    const controller = {
      initialize: jest.fn(), render: jest.fn(), reset: jest.fn(), pause: jest.fn(),
      getStats: jest.fn(() => ({ spp: 2 })), destroy: jest.fn(),
    };
    const workerFactory = jest.fn();
    const engine = await initCpuRayEngine({
      canvas,
      workerFactory,
      controllerFactory: (options) => { callbacks = options; return controller; },
      settings: { resolutionScale: 1, maxDimension: 256 },
    });
    expect(callbacks.workerFactory).toBe(workerFactory);
    const scene = engine.loadCornellBox();
    expect(scene.instances).toHaveLength(8);
    expect(controller.initialize).toHaveBeenCalledTimes(1);
    engine.resume();
    expect(controller.render).toHaveBeenCalledWith(expect.objectContaining({ width: 256, height: 192 }));

    engine.pause();
    engine.resetAccumulation();
    expect(controller.pause).toHaveBeenCalledTimes(1);
    expect(controller.reset).toHaveBeenCalledWith(expect.objectContaining({ width: 256, height: 192 }));

    callbacks.presentTile({ x: 0, y: 0, width: 1, height: 1, rgbaBuffer: new Uint8ClampedArray([1,2,3,255]).buffer });
    expect(canvas.context.putImageData).toHaveBeenCalledWith(expect.objectContaining({ width: 1, height: 1 }), 0, 0);
    expect(engine.getStats()).toEqual(expect.objectContaining({ spp: 2, triangleCount: 36, instanceCount: 8 }));

    engine.destroy();
    engine.destroy();
    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(4);
  });
});
