import { createRayTracingCoordinator } from '../scripts/engine/raytracing-coordinator.js';

function canvas() {
  return { getContext: jest.fn() };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ray tracing coordinator', () => {
  const OriginalWorker = global.Worker;
  beforeEach(() => { global.Worker = function Worker() {}; });
  afterAll(() => { global.Worker = OriginalWorker; });

  test('switches one presentation loop and retains the CPU scene', async () => {
    const rasterPose = { target: [0, 0, 0], zoom: 5 };
    const raster = {
      camera: { getState: jest.fn(() => rasterPose), setState: jest.fn() },
      scene: { pause: jest.fn(), resume: jest.fn() },
      getStats: jest.fn(() => ({ backend: 'webgl' })),
    };
    const cornellScene = {
      name: 'Cornell',
      camera: { eye: [0, 1, 3.2], target: [0, 1, 0], up: [0, 1, 0] },
    };
    const cpu = {
      camera: { getState: jest.fn(() => ({ target: [0, 1, 0], zoom: 3.2 })), setState: jest.fn() },
      loadCornellBox: jest.fn(() => cornellScene),
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
    expect(cpu.camera.setState).not.toHaveBeenCalled();
    expect(coordinator.getStats()).toEqual({ backend: 'cpu', spp: 3 });
    await coordinator.setRenderMode('raster');
    expect(cpu.pause).toHaveBeenCalledTimes(1);
    expect(raster.scene.resume).toHaveBeenCalledTimes(1);
    expect(cpu.loadCornellBox).toHaveBeenCalledTimes(1);
    expect(modes).toEqual(['raytrace-cpu', 'raster']);
  });

  test('rejects unsupported modes and destroys CPU once', async () => {
    const cpu = { loadCornellBox: jest.fn(() => ({ name: 'Cornell' })), destroy: jest.fn() };
    const coordinator = createRayTracingCoordinator({ cpuCanvas: canvas(), cpuFactory: async () => cpu });
    await expect(coordinator.setRenderMode('raytrace-gpu')).rejects.toMatchObject({ code: 'UNSUPPORTED_RENDER_MODE' });
    await coordinator.loadCornellBox();
    coordinator.destroy();
    coordinator.destroy();
    expect(cpu.destroy).toHaveBeenCalledTimes(1);
  });

  test('switches between retained GPU Cornell, CPU Cornell, and raster loops', async () => {
    const cornellScene = { name: 'Cornell' };
    const raster = {
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({ 'raytrace-gpu': { available: true } })),
      loadCornellBox: jest.fn(() => ({ kind: 'raytrace', scene: cornellScene })),
      setRenderMode: jest.fn(async () => {}),
      setRayTracingSettings: jest.fn(),
      resetAccumulation: jest.fn(),
      getStats: jest.fn(() => ({ backend: 'webgpu', renderMode: 'raytrace-gpu', spp: 4 })),
    };
    const cpu = {
      loadCornellBox: jest.fn(), loadRayScene: jest.fn(),
      resume: jest.fn(), pause: jest.fn(), destroy: jest.fn(),
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
    expect(cpu.loadRayScene).toHaveBeenCalledWith(cornellScene);
    expect(raster.scene.pause).toHaveBeenCalled();
    expect(cpu.resume).toHaveBeenCalled();
    await coordinator.setRenderMode('raster');
    expect(raster.scene.resume).toHaveBeenCalled();
    expect(modes).toEqual(['raytrace-gpu', 'raytrace-cpu', 'raster']);
  });

  test('shares one retained glTF RayScene and camera pose across CPU and GPU modes', async () => {
    const preparedRayScene = { geometries: [{}], instances: [{}] };
    const rasterPose = { target: [1, 2, 3], rotationX: 0.1, rotationY: 0.2, zoom: 5 };
    const cpuPose = { target: [3, 2, 1], rotationX: 0.3, rotationY: 0.4, zoom: 7 };
    const raster = {
      camera: { getState: jest.fn(() => rasterPose), setState: jest.fn() },
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({
        'raytrace-gpu': { available: true },
        'hybrid-shadows': { available: true },
      })),
      loadRayScene: jest.fn(() => ({ kind: 'raytrace' })),
      setRenderMode: jest.fn(async () => {}),
    };
    const cpu = {
      camera: { getState: jest.fn(() => cpuPose), setState: jest.fn() },
      loadRayScene: jest.fn(), resume: jest.fn(), pause: jest.fn(), destroy: jest.fn(),
    };
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(), cpuFactory: async () => cpu,
    });
    coordinator.setRasterEngine(raster);
    await coordinator.setSceneAsset({
      preparedRayScene,
      geometryRevision: 4,
      instanceRevision: 9,
    });

    await coordinator.setRenderMode('raytrace-cpu');
    expect(cpu.loadRayScene).toHaveBeenCalledWith(preparedRayScene);
    expect(cpu.camera.setState).toHaveBeenCalledWith(rasterPose);

    await coordinator.setRenderMode('raytrace-gpu');
    expect(raster.loadRayScene).toHaveBeenCalledWith(preparedRayScene, {
      revisions: {
        geometryRevision: 4,
        instanceRevision: 9,
        materialRevision: 0,
        lightRevision: 0,
        cameraRevision: 0,
        settingsRevision: 0,
      },
    });
    expect(raster.camera.setState).toHaveBeenLastCalledWith(cpuPose);
    expect(raster.setRenderMode).toHaveBeenLastCalledWith('raytrace-gpu');
    expect(coordinator.getSceneAsset().preparedRayScene).toBe(preparedRayScene);
  });

  test('routes hybrid controls and returns to raster when the retained asset is cleared', async () => {
    const retainedImage = { close: jest.fn() };
    const raster = {
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({ 'hybrid-shadows': { available: true } })),
      setRenderMode: jest.fn(async () => {}),
      setLight: jest.fn(),
    };
    const modes = [];
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(),
      cpuFactory: async () => ({ destroy: jest.fn() }),
      onModeChange: (value) => modes.push(value),
    });
    coordinator.setRasterEngine(raster);
    await coordinator.setSceneAsset({
      rayTracing: {
        preparedRayScene: { geometries: [], instances: [] },
        asset: { images: [retainedImage] },
      },
    });
    await coordinator.setRenderMode('hybrid-shadows');
    coordinator.setLight({ type: 'directional', direction: [0, -1, 0] });
    coordinator.pause();
    coordinator.resume();
    expect(raster.setLight).toHaveBeenCalledWith({ type: 'directional', direction: [0, -1, 0] });
    expect(raster.scene.pause).toHaveBeenCalled();
    expect(raster.scene.resume).toHaveBeenCalled();

    await coordinator.setSceneAsset(null);
    expect(raster.setRenderMode).toHaveBeenLastCalledWith('raster');
    expect(coordinator.getRenderMode()).toBe('raster');
    expect(modes).toEqual(['hybrid-shadows', 'raster']);
    expect(retainedImage.close).toHaveBeenCalledTimes(1);
  });

  test('survives the complete mode sequence, resize, asset replacement, and repeated destruction', async () => {
    const firstImage = { close: jest.fn() };
    const secondImage = { close: jest.fn() };
    const firstScene = { name: 'first' };
    const secondScene = { name: 'second' };
    const raster = {
      camera: { getState: jest.fn(() => ({ zoom: 4 })), setState: jest.fn() },
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({
        'raytrace-gpu': { available: true },
        'hybrid-shadows': { available: true },
      })),
      loadRayScene: jest.fn(async (scene) => ({ kind: 'raytrace', scene })),
      setRenderMode: jest.fn(async () => {}),
    };
    const cpu = {
      camera: { getState: jest.fn(() => ({ zoom: 6 })), setState: jest.fn() },
      loadRayScene: jest.fn(), resume: jest.fn(), pause: jest.fn(), resize: jest.fn(), destroy: jest.fn(),
    };
    const modes = [];
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(), cpuFactory: async () => cpu, onModeChange: (value) => modes.push(value),
    });
    coordinator.setRasterEngine(raster);
    await coordinator.setSceneAsset({
      preparedRayScene: firstScene,
      asset: { images: [firstImage] },
    });

    await coordinator.setRenderMode('raytrace-cpu');
    coordinator.resize();
    await coordinator.setRenderMode('raytrace-gpu');
    await coordinator.setRenderMode('hybrid-shadows');
    await coordinator.setRenderMode('raster');

    expect(cpu.loadRayScene).toHaveBeenCalledWith(firstScene);
    expect(cpu.resize).toHaveBeenCalledTimes(1);
    expect(raster.loadRayScene).toHaveBeenCalledWith(firstScene, expect.any(Object));
    expect(raster.setRenderMode.mock.calls.map(([value]) => value)).toEqual([
      'raytrace-gpu', 'hybrid-shadows', 'raster',
    ]);
    expect(modes).toEqual(['raytrace-cpu', 'raytrace-gpu', 'hybrid-shadows', 'raster']);

    await coordinator.setSceneAsset({
      preparedRayScene: secondScene,
      asset: { images: [secondImage] },
    });
    expect(firstImage.close).toHaveBeenCalledTimes(1);
    coordinator.destroy();
    coordinator.destroy();
    coordinator.resize();
    expect(secondImage.close).toHaveBeenCalledTimes(1);
    expect(cpu.destroy).toHaveBeenCalledTimes(1);
  });

  test('an obsolete GPU asset load cannot replace the newest retained scene', async () => {
    const firstLoad = deferred();
    const secondLoad = deferred();
    const firstScene = { name: 'slow' };
    const secondScene = { name: 'newest' };
    const raster = {
      scene: { pause: jest.fn(), resume: jest.fn() },
      getCapabilities: jest.fn(() => ({ 'raytrace-gpu': { available: true } })),
      loadRayScene: jest.fn((scene) => (
        scene === firstScene ? firstLoad.promise : secondLoad.promise
      )),
      setRenderMode: jest.fn(async () => {}),
    };
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: canvas(), cpuFactory: async () => ({ destroy: jest.fn() }),
    });
    coordinator.setRasterEngine(raster);
    await coordinator.setSceneAsset({ preparedRayScene: firstScene });
    const switching = coordinator.setRenderMode('raytrace-gpu');
    await Promise.resolve();
    expect(raster.loadRayScene).toHaveBeenCalledWith(firstScene, expect.any(Object));

    await coordinator.setSceneAsset({ preparedRayScene: secondScene });
    firstLoad.resolve({ kind: 'raytrace', scene: firstScene });
    await Promise.resolve();
    await Promise.resolve();
    expect(raster.loadRayScene).toHaveBeenLastCalledWith(secondScene, expect.any(Object));
    secondLoad.resolve({ kind: 'raytrace', scene: secondScene });
    await switching;

    expect(coordinator.getSceneAsset().preparedRayScene).toBe(secondScene);
    expect(raster.setRenderMode).toHaveBeenLastCalledWith('raytrace-gpu');
    coordinator.destroy();
  });
});
