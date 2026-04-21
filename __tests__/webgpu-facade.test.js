const mockScene = {
  loadGeometry: jest.fn(),
  updatePipeline: jest.fn(),
  updateUserScript: jest.fn(),
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
});
