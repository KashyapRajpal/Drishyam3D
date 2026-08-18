const mockScene = {
  loadGeometry: jest.fn(),
  updatePipeline: jest.fn(),
  updateUserScript: jest.fn(),
  setRayTracingShader: jest.fn(() => true),
  setRenderMode: jest.fn(),
  setRayTracingSettings: jest.fn(),
  resetRayAccumulation: jest.fn(),
  loadRayGeometry: jest.fn(),
  updateRayTlasAndInstances: jest.fn(),
  getRenderMode: jest.fn(() => 'raster'),
  readRayAccumulation: jest.fn(),
  readRayDiagnostics: jest.fn(),
  start: jest.fn(),
  destroy: jest.fn(),
};

jest.mock('../scripts/engine/webgpu-scene.js', () => ({
  createWebGPUScene: jest.fn(() => mockScene),
}));

const mockInitWebGPU = jest.fn();
const mockCreateRenderPipeline = jest.fn();
const mockCreateVertexBuffer = jest.fn(() => ({ kind: 'vb' }));
const mockCreateIndexBuffer = jest.fn(() => ({ kind: 'ib' }));
const mockCreateTextureFromUrl = jest.fn(async () => ({ kind: 'tex' }));

jest.mock('../scripts/engine/webgpu-helpers.js', () => ({
  initWebGPU: (...args) => mockInitWebGPU(...args),
  createRenderPipeline: (...args) => mockCreateRenderPipeline(...args),
  createVertexBuffer: (...args) => mockCreateVertexBuffer(...args),
  createIndexBuffer: (...args) => mockCreateIndexBuffer(...args),
  createTextureFromUrl: (...args) => mockCreateTextureFromUrl(...args),
}));

import { initWebGPUEngine, createWebGPUGeometryFactory } from '../scripts/engine/webgpu-facade.js';

describe('WebGPU Facade', () => {
  const fakeDevice = { id: 'device' };
  const fakeContext = { id: 'context' };
  const fakeCanvas = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockInitWebGPU.mockResolvedValue({
      device: fakeDevice,
      context: fakeContext,
      format: 'bgra8unorm',
    });
    mockCreateRenderPipeline.mockReturnValue({ id: 'pipeline' });
  });

  test('returns null and reports error when canvas is missing', async () => {
    const onError = jest.fn();
    const result = await initWebGPUEngine({
      canvas: null,
      shaderSources: { wgsl: 'shader' },
      scriptSource: 'function init(){}\nfunction update(){}',
      onError,
    });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  test('initializes engine and starts scene with valid WGSL/script', async () => {
    const result = await initWebGPUEngine({
      canvas: fakeCanvas,
      shaderSources: { wgsl: '@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }' },
      scriptSource: 'function init(){}\nfunction update(){}',
      onError: jest.fn(),
    });

    expect(result).toBeTruthy();
    expect(mockScene.loadGeometry).toHaveBeenCalled();
    expect(mockScene.start).toHaveBeenCalled();
    expect(typeof result.setShaders).toBe('function');
    expect(typeof result.setScriptSource).toBe('function');
  });

  test('returns null when WGSL source is missing', async () => {
    const onError = jest.fn();
    const result = await initWebGPUEngine({
      canvas: fakeCanvas,
      shaderSources: {},
      scriptSource: 'function init(){}\nfunction update(){}',
      onError,
    });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  test('createWebGPUGeometryFactory textured shape falls back when texture load fails', async () => {
    mockCreateTextureFromUrl.mockRejectedValueOnce(new Error('texture fail'));
    const factory = createWebGPUGeometryFactory(fakeDevice, 'https://example.com/tex.png');

    const drawable = await factory.createTexturedCube();

    expect(drawable).toBeTruthy();
    expect(drawable.texture).toBeNull();
    expect(drawable.vertexCount).toBeGreaterThan(0);
  });

  test('loads Cornell Box, exposes GPU mode controls, and retains BLASes for transform revisions', async () => {
    const result = await initWebGPUEngine({
      canvas: fakeCanvas,
      shaderSources: { wgsl: 'mesh shader', raytraceWgsl: 'ray shader' },
      scriptSource: 'function init(){}\nfunction update(){}',
      onError: jest.fn(),
    });
    expect(mockScene.setRayTracingShader).toHaveBeenCalledWith('ray shader');
    expect(result.getCapabilities()['raytrace-gpu']).toEqual({ available: true, reason: undefined });

    const first = result.loadCornellBox();
    expect(first).toMatchObject({ kind: 'raytrace', revisions: { geometryRevision: 0, instanceRevision: 0 } });
    expect(mockScene.loadRayGeometry).toHaveBeenCalledWith(first);
    const firstBlases = first.acceleration.blases;
    expect(result.loadRayScene(first.scene)).toBe(first);
    expect(mockScene.resetRayAccumulation).not.toHaveBeenCalled();
    const updated = result.loadRayScene(first.scene, { revisions: { instanceRevision: 1 } });
    expect(updated).toBe(first);
    expect(updated.acceleration.blases[0]).toBe(firstBlases[0]);
    expect(mockScene.updateRayTlasAndInstances).toHaveBeenCalledWith(
      first,
      first.packedScene,
      expect.objectContaining({ nodeByteLength: expect.any(Number), instanceByteLength: expect.any(Number) }),
    );

    await expect(result.setRenderMode('raytrace-gpu')).resolves.toBe('raytrace-gpu');
    expect(mockScene.setRenderMode).toHaveBeenCalledWith('raytrace-gpu');
    result.setRayTracingSettings({ maxBounces: 3 });
    result.resetAccumulation();
    expect(mockScene.setRayTracingSettings).toHaveBeenCalledWith({ maxBounces: 3 });
    expect(mockScene.resetRayAccumulation).toHaveBeenCalled();
  });

  test('reports GPU ray tracing unavailable when its shader was not supplied', async () => {
    const result = await initWebGPUEngine({
      canvas: fakeCanvas,
      shaderSources: { wgsl: 'mesh shader' },
      scriptSource: 'function init(){}\nfunction update(){}',
      onError: jest.fn(),
    });
    expect(result.getCapabilities()['raytrace-gpu']).toMatchObject({ available: false });
    expect(result.getCapabilities()['raytrace-gpu'].reason).toMatch(/shader is unavailable/);
  });
});
