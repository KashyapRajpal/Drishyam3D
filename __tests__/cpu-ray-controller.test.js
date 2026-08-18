import { createCpuRayController } from '../scripts/engine/raytracing/cpu/cpu-ray-controller.js';

function createMockWorker() {
  return {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    emit(data) { this.onmessage?.({ data }); },
  };
}

function setup() {
  const worker = createMockWorker();
  const presentTile = jest.fn();
  const onStats = jest.fn();
  const onError = jest.fn();
  const controller = createCpuRayController({ workerFactory: () => worker, presentTile, onStats, onError });
  return { worker, presentTile, onStats, onError, controller };
}

describe('CPU ray controller', () => {
  test('orders init, ready, render, and progressive pass messages', () => {
    const { worker, controller, onStats } = setup();
    const generation = controller.initialize({ name: 'scene' }, { name: 'acceleration' }, { maxBounces: 2 });
    controller.render({ width: 64, height: 32, cameraFrame: { eye: [0,0,1] } });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ type: 'init', generation });
    worker.emit({ type: 'ready', generation });
    expect(worker.postMessage.mock.calls[1][0]).toMatchObject({
      type: 'render', generation, passIndex: 0, width: 64, height: 32, tileSize: 32,
    });
    worker.emit({ type: 'pass-complete', generation, spp: 1, elapsedMs: 20, rays: 1000 });
    expect(onStats).toHaveBeenCalledWith(expect.objectContaining({ spp: 1, raysPerSecond: 50000 }));
    expect(worker.postMessage.mock.calls[2][0]).toMatchObject({ type: 'render', passIndex: 1 });
  });

  test('rejects stale tiles after a generation reset', () => {
    const { worker, controller, presentTile } = setup();
    const oldGeneration = controller.initialize({}, {}, {});
    controller.render({ width: 1, height: 1, cameraFrame: {} });
    const nextGeneration = controller.initialize({}, {}, {});
    worker.emit({ type: 'tile', generation: oldGeneration, rgbaBuffer: new ArrayBuffer(4) });
    expect(presentTile).not.toHaveBeenCalled();
    worker.emit({ type: 'tile', generation: nextGeneration, rgbaBuffer: new ArrayBuffer(4) });
    expect(presentTile).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls.some(([message]) => message.type === 'cancel')).toBe(true);
  });

  test('forwards worker errors and stops requesting passes', () => {
    const { worker, controller, onError } = setup();
    const generation = controller.initialize({}, {}, {});
    controller.render({ width: 1, height: 1, cameraFrame: {} });
    worker.emit({ type: 'ready', generation });
    worker.emit({ type: 'error', generation, message: 'trace failed' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'trace failed' }));
    const callCount = worker.postMessage.mock.calls.length;
    worker.emit({ type: 'pass-complete', generation, spp: 1, elapsedMs: 1, rays: 1 });
    expect(worker.postMessage).toHaveBeenCalledTimes(callCount);
  });

  test('pause/resume resets partial accumulation and destroy is idempotent', () => {
    const { worker, controller } = setup();
    const firstGeneration = controller.initialize({}, {}, {});
    controller.render({ width: 1, height: 1, cameraFrame: {} });
    worker.emit({ type: 'ready', generation: firstGeneration });
    controller.pause();
    controller.resume();
    expect(controller.getGeneration()).toBe(firstGeneration + 1);
    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'init')).toHaveLength(2);
    controller.destroy();
    controller.destroy();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls.filter(([message]) => message.type === 'destroy')).toHaveLength(1);
  });
});
