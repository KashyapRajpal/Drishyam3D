import {
  HYBRID_GBUFFER_FORMATS,
  createHybridGBuffer,
  createHybridVisibilityFallback,
  destroyHybridGBuffer,
} from '../scripts/engine/raytracing/hybrid/gbuffer-layout.js';
import { HybridShadowRenderer } from '../scripts/engine/renderers/hybrid-shadow-renderer.js';
import { createIdentityMatrix } from '../scripts/engine/matrix.js';

function trackedResource(desc = {}) {
  const resource = {
    desc,
    destroy: jest.fn(),
    createView: jest.fn(() => ({ resource })),
  };
  return resource;
}

function deviceHarness() {
  const textures = [];
  const buffers = [];
  const device = {
    queue: { writeTexture: jest.fn(), writeBuffer: jest.fn() },
    createTexture: jest.fn((desc) => {
      const texture = trackedResource(desc);
      textures.push(texture);
      return texture;
    }),
    createBuffer: jest.fn((desc) => {
      const buffer = trackedResource(desc);
      buffers.push(buffer);
      return buffer;
    }),
    createSampler: jest.fn(() => ({ sampler: true })),
    createBindGroupLayout: jest.fn((desc) => ({ desc })),
    createPipelineLayout: jest.fn((desc) => ({ desc })),
    createBindGroup: jest.fn((desc) => ({ desc })),
    createShaderModule: jest.fn((desc) => ({ desc })),
    createRenderPipeline: jest.fn((desc) => ({ desc })),
  };
  return { device, textures, buffers };
}

function passHarness() {
  return {
    setPipeline: jest.fn(),
    setBindGroup: jest.fn(),
    setVertexBuffer: jest.fn(),
    setIndexBuffer: jest.fn(),
    drawIndexed: jest.fn(),
    draw: jest.fn(),
    end: jest.fn(),
  };
}

function meshBuffers(name) {
  return {
    position: trackedResource({ name: `${name}-position` }),
    normal: trackedResource({ name: `${name}-normal` }),
    texCoord: trackedResource({ name: `${name}-texcoord` }),
    indices: trackedResource({ name: `${name}-indices` }),
  };
}

describe('hybrid G-buffer resources', () => {
  beforeEach(() => {
    global.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
  });

  test('uses the specified formats and destroys a complete attachment set once', () => {
    const { device, textures } = deviceHarness();
    const gbuffer = createHybridGBuffer(device, 32, 16);
    expect(device.createTexture.mock.calls.map((call) => call[0].format)).toEqual([
      HYBRID_GBUFFER_FORMATS.worldPosition,
      HYBRID_GBUFFER_FORMATS.normal,
      HYBRID_GBUFFER_FORMATS.albedo,
      HYBRID_GBUFFER_FORMATS.depth,
    ]);
    destroyHybridGBuffer(gbuffer);
    destroyHybridGBuffer(gbuffer);
    textures.forEach((texture) => expect(texture.destroy).toHaveBeenCalledTimes(1));
  });

  test('creates a one-pixel fully visible shadow fallback', () => {
    const { device } = deviceHarness();
    const fallback = createHybridVisibilityFallback(device);
    expect(fallback.desc).toMatchObject({ size: [1, 1, 1], format: 'rgba8unorm' });
    expect(device.queue.writeTexture.mock.calls[0][1]).toEqual(new Uint8Array([255, 0, 0, 255]));
  });
});

describe('HybridShadowRenderer G-buffer foundation', () => {
  beforeEach(() => {
    global.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
    global.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
    global.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  });

  test('records G-buffer then composite and draws every mesh primitive', () => {
    const { device } = deviceHarness();
    const passes = [];
    const encoder = {
      beginRenderPass: jest.fn((desc) => {
        const pass = passHarness();
        passes.push({ desc, pass });
        return pass;
      }),
    };
    const texture = trackedResource({ name: 'borrowed-texture' });
    const drawable = {
      kind: 'mesh',
      vertexCount: 9,
      rayTracing: { preparedRayScene: {} },
      primitives: [
        { buffers: meshBuffers('a'), texture, indexCount: 3, indexFormat: 'uint16', material: { baseColor: [1, 0, 0, 1] }, worldMatrix: createIdentityMatrix() },
        { buffers: meshBuffers('b'), texture: null, indexCount: 6, indexFormat: 'uint32', material: { baseColor: [0, 1, 0, 1] }, worldMatrix: createIdentityMatrix() },
      ],
    };
    const renderer = new HybridShadowRenderer(device, 'bgra8unorm');
    renderer.setShaders('gbuffer shader', 'composite shader');
    renderer.setLight({ type: 'point', position: [2, 3, 4], color: [1, 0.8, 0.6], intensity: 5 });
    renderer.prepare(drawable);
    renderer.record({
      device,
      encoder,
      targetView: 'target',
      viewMatrix: createIdentityMatrix(),
      projectionMatrix: createIdentityMatrix(),
      width: 80,
      height: 60,
      sceneState: { modelViewMatrix: createIdentityMatrix() },
      gpuTimer: { span: jest.fn((name) => ({ name })) },
    }, drawable);

    expect(passes.map(({ desc }) => desc.label)).toEqual(['Hybrid G-buffer pass', 'Hybrid composite pass']);
    expect(passes[0].pass.drawIndexed.mock.calls.map((call) => call[0])).toEqual([3, 6]);
    expect(passes[0].pass.setBindGroup.mock.calls.filter((call) => call[0] === 0)[0][1])
      .not.toBe(passes[0].pass.setBindGroup.mock.calls.filter((call) => call[0] === 0)[1][1]);
    expect(passes[1].pass.draw).toHaveBeenCalledWith(3);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(5); // frame + material per draw, then light
    expect(renderer.getStats()).toMatchObject({ renderMode: 'hybrid-shadows', triangleCount: 3, instanceCount: 2 });
  });

  test('replaces all attachments before destroying the old set and never destroys borrowed mesh resources', () => {
    const { device } = deviceHarness();
    const drawable = {
      kind: 'mesh',
      vertexCount: 3,
      primitives: [{
        buffers: meshBuffers('shared'),
        texture: trackedResource({ name: 'borrowed-texture' }),
        indexCount: 3,
        worldMatrix: createIdentityMatrix(),
      }],
    };
    const renderer = new HybridShadowRenderer(device, 'bgra8unorm');
    renderer.setShaders('gbuffer shader', 'composite shader');
    const record = (width, height) => renderer.record({
      device,
      encoder: { beginRenderPass: jest.fn(() => passHarness()) },
      targetView: 'target',
      viewMatrix: createIdentityMatrix(),
      projectionMatrix: createIdentityMatrix(),
      width,
      height,
      sceneState: { modelViewMatrix: createIdentityMatrix() },
    }, drawable);
    record(20, 10);
    const oldGBuffer = renderer.gbuffer;
    record(40, 30);
    expect(renderer.gbuffer).not.toBe(oldGBuffer);
    for (const attachment of [oldGBuffer.worldPosition, oldGBuffer.normal, oldGBuffer.albedo, oldGBuffer.depth]) {
      expect(attachment.texture.destroy).toHaveBeenCalledTimes(1);
    }

    renderer.releaseDrawable(drawable);
    renderer.releaseDrawable(drawable);
    Object.values(drawable.primitives[0].buffers).forEach((buffer) => expect(buffer.destroy).not.toHaveBeenCalled());
    expect(drawable.primitives[0].texture.destroy).not.toHaveBeenCalled();
    renderer.destroy();
    renderer.destroy();
    for (const attachment of [renderer.gbuffer].filter(Boolean)) expect(attachment.destroyed).toBe(true);
  });

  test('validates directional and point light inputs', () => {
    const { device } = deviceHarness();
    const renderer = new HybridShadowRenderer(device, 'bgra8unorm');
    expect(() => renderer.setLight({ type: 'spot' })).toThrow(/directional or point/);
    expect(() => renderer.setLight({ type: 'point' })).toThrow(/point light vector/);
    expect(() => renderer.setLight({ intensity: -1 })).toThrow(/intensity/);
  });
});
