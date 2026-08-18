const mockUniformBuffers = [];
const mockCreateUniformBuffer = jest.fn((_device, size) => {
  const resource = { size, destroy: jest.fn() };
  mockUniformBuffers.push(resource);
  return resource;
});
const mockDefaultTexture = { createView: jest.fn(() => 'default-view'), destroy: jest.fn() };
const mockDepthTexture = { createView: jest.fn(() => 'depth-view'), destroy: jest.fn() };
const mockCreateBindGroup = jest.fn((_device, _pipeline, resources) => ({
  id: `bind-${mockCreateBindGroup.mock.calls.length}`,
  resources,
}));

jest.mock('../scripts/engine/webgpu-helpers.js', () => ({
  MATRIX_UNIFORM_SIZE: 128,
  MATERIAL_UNIFORM_SIZE: 32,
  createUniformBuffer: (...args) => mockCreateUniformBuffer(...args),
  createDefaultTexture: jest.fn(() => mockDefaultTexture),
  createSampler: jest.fn(() => ({ sampler: true })),
  createDepthTexture: jest.fn(() => mockDepthTexture),
  createBindGroup: (...args) => mockCreateBindGroup(...args),
}));

import { getMeshPrimitives, MeshRenderer } from '../scripts/engine/renderers/mesh-renderer.js';
import { createIdentityMatrix } from '../scripts/engine/matrix.js';

function resource(name) {
  return { name, destroy: jest.fn() };
}

function buffers(prefix) {
  return {
    position: resource(`${prefix}-position`),
    normal: resource(`${prefix}-normal`),
    texCoord: resource(`${prefix}-texcoord`),
    indices: resource(`${prefix}-indices`),
  };
}

function translated(x) {
  const matrix = createIdentityMatrix();
  matrix[12] = x;
  return matrix;
}

function harness() {
  const pass = {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    setVertexBuffer: jest.fn(),
    setIndexBuffer: jest.fn(),
    drawIndexed: jest.fn(),
    end: jest.fn(),
  };
  const device = { queue: { writeBuffer: jest.fn() } };
  const frame = {
    device,
    encoder: { beginRenderPass: jest.fn(() => pass) },
    targetView: 'target-view',
    viewMatrix: createIdentityMatrix(),
    projectionMatrix: createIdentityMatrix(),
    width: 640,
    height: 480,
    sceneState: { modelViewMatrix: translated(10) },
  };
  const renderer = new MeshRenderer(device, 'bgra8unorm');
  renderer.init();
  renderer.setPipeline({ getBindGroupLayout: jest.fn() });
  return { renderer, device, frame, pass };
}

describe('MeshRenderer primitive draw contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUniformBuffers.length = 0;
  });

  test('adapts a legacy drawable to one stable identity primitive', () => {
    const drawable = { buffers: buffers('legacy'), texture: null, vertexCount: 3, indexFormat: 'uint16' };
    const first = getMeshPrimitives(drawable);
    expect(first).toBe(getMeshPrimitives(drawable));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ buffers: drawable.buffers, indexCount: 3, indexFormat: 'uint16' });
    expect([...first[0].worldMatrix]).toEqual([...createIdentityMatrix()]);
    expect(drawable.primitives).toBeUndefined();

    const { renderer, frame, pass } = harness();
    renderer.record(frame, drawable);
    renderer.record(frame, drawable);
    expect(pass.drawIndexed).toHaveBeenCalledTimes(2);
    expect(mockCreateUniformBuffer).toHaveBeenCalledTimes(2); // Cached across frames.
  });

  test('records two draws with distinct uniforms, materials, and instance transforms', () => {
    const textureA = { createView: jest.fn(() => 'a'), destroy: jest.fn() };
    const drawable = {
      kind: 'mesh',
      primitives: [
        {
          buffers: buffers('a'), texture: textureA, indexCount: 3, indexFormat: 'uint16',
          material: { baseColor: [1, 0, 0, 1] }, worldMatrix: translated(1), instanceIndex: 0,
        },
        {
          buffers: buffers('b'), texture: null, indexCount: 6, indexFormat: 'uint32',
          material: { baseColor: [0, 1, 0, 1] }, worldMatrix: translated(2), instanceIndex: 1,
        },
      ],
    };
    const { renderer, device, frame, pass } = harness();
    renderer.prepare(drawable);
    renderer.record(frame, drawable);

    expect(mockCreateUniformBuffer.mock.calls.map((call) => call[1])).toEqual([128, 32, 128, 32]);
    expect(mockCreateBindGroup).toHaveBeenCalledTimes(2);
    expect(mockCreateBindGroup.mock.calls[0][2].materialBuffer)
      .not.toBe(mockCreateBindGroup.mock.calls[1][2].materialBuffer);
    expect(pass.setBindGroup.mock.calls[0][1]).not.toBe(pass.setBindGroup.mock.calls[1][1]);
    expect(pass.setIndexBuffer.mock.calls.map((call) => call[1])).toEqual(['uint16', 'uint32']);
    expect(pass.drawIndexed.mock.calls.map((call) => call[0])).toEqual([3, 6]);

    const matrixWrites = [device.queue.writeBuffer.mock.calls[0][2], device.queue.writeBuffer.mock.calls[2][2]];
    expect(matrixWrites[0][28]).toBeCloseTo(11); // userModel(10) * instance(1)
    expect(matrixWrites[1][28]).toBeCloseTo(12); // userModel(10) * instance(2)
    const materialWrites = [device.queue.writeBuffer.mock.calls[1][2], device.queue.writeBuffer.mock.calls[3][2]];
    expect([...materialWrites[0].subarray(0, 4)]).toEqual([1, 0, 0, 1]);
    expect([...materialWrites[1].subarray(0, 4)]).toEqual([0, 1, 0, 1]);
  });

  test('releases shared primitive resources and owned uniforms exactly once', () => {
    const sharedBuffers = buffers('shared');
    const sharedTexture = { createView: jest.fn(), destroy: jest.fn() };
    const drawable = {
      primitives: [
        { buffers: sharedBuffers, texture: sharedTexture, indexCount: 3 },
        { buffers: sharedBuffers, texture: sharedTexture, indexCount: 3 },
      ],
    };
    const { renderer } = harness();
    renderer.prepare(drawable);
    renderer.releaseDrawable(drawable);
    renderer.releaseDrawable(drawable);
    renderer.destroy();
    renderer.destroy();

    Object.values(sharedBuffers).forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledTimes(1));
    expect(sharedTexture.destroy).toHaveBeenCalledTimes(1);
    mockUniformBuffers.forEach((buffer) => expect(buffer.destroy).toHaveBeenCalledTimes(1));
    expect(mockDefaultTexture.destroy).toHaveBeenCalledTimes(1);
  });
});
