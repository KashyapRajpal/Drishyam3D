import {
  packSplats,
  nextPow2,
  SPLAT_FLOATS,
  SPLAT_STRIDE,
  createSplatStorageBuffer,
  createSortBuffers,
  createSplatRenderPipeline,
  createSplatDebugPipeline,
  createSortPipelines,
} from '../scripts/engine/splat-helpers.js';

// Single-splat parsed input with identity rotation; scale varies per test.
function oneSplat({ scale = [1, 1, 1] } = {}) {
  return {
    positions: new Float32Array([1, 2, 3]),
    colors: new Float32Array([0.1, 0.2, 0.3]),
    opacities: new Float32Array([0.5]),
    scales: new Float32Array(scale),
    rotations: new Float32Array([1, 0, 0, 0]), // identity quaternion (w,x,y,z)
    count: 1,
  };
}

describe('nextPow2', () => {
  test.each([[0, 1], [1, 1], [2, 2], [3, 4], [5, 8], [1024, 1024], [1025, 2048]])(
    'nextPow2(%i) = %i', (n, expected) => {
      expect(nextPow2(n)).toBe(expected);
    });
});

describe('packSplats', () => {
  test('packs position, color, opacity at the right offsets', () => {
    const packed = packSplats(oneSplat());
    expect(packed.length).toBe(SPLAT_FLOATS);
    expect(packed.byteLength).toBe(SPLAT_STRIDE);

    expect(Array.from(packed.slice(0, 3))).toEqual([1, 2, 3]); // position
    expect(packed[4]).toBeCloseTo(0.1, 6);
    expect(packed[5]).toBeCloseTo(0.2, 6);
    expect(packed[6]).toBeCloseTo(0.3, 6);
    expect(packed[7]).toBeCloseTo(0.5, 6); // opacity
  });

  test('identity rotation + unit scale -> identity covariance', () => {
    const packed = packSplats(oneSplat());
    // σxx,σxy,σxz
    expect(packed[8]).toBeCloseTo(1, 6);
    expect(packed[9]).toBeCloseTo(0, 6);
    expect(packed[10]).toBeCloseTo(0, 6);
    // σyy,σyz,σzz
    expect(packed[12]).toBeCloseTo(1, 6);
    expect(packed[13]).toBeCloseTo(0, 6);
    expect(packed[14]).toBeCloseTo(1, 6);
  });

  test('anisotropic scale squares into the diagonal covariance', () => {
    const packed = packSplats(oneSplat({ scale: [2, 1, 3] }));
    expect(packed[8]).toBeCloseTo(4, 6);  // σxx = 2²
    expect(packed[12]).toBeCloseTo(1, 6); // σyy = 1²
    expect(packed[14]).toBeCloseTo(9, 6); // σzz = 3²
    // off-diagonals stay zero for identity rotation
    expect(packed[9]).toBeCloseTo(0, 6);
    expect(packed[13]).toBeCloseTo(0, 6);
  });
});

describe('GPU resource helpers (mocked device)', () => {
  let device;
  const buffers = [];
  const pipelines = [];

  beforeEach(() => {
    buffers.length = 0;
    pipelines.length = 0;
    global.GPUBufferUsage = {
      STORAGE: 0x80,
      COPY_DST: 0x08,
      COPY_SRC: 0x04,
      UNIFORM: 0x40,
    };
    device = {
      createBuffer: jest.fn((desc) => { const b = { desc, destroy: jest.fn() }; buffers.push(b); return b; }),
      createShaderModule: jest.fn((desc) => ({ desc })),
      createRenderPipeline: jest.fn((desc) => { pipelines.push(desc); return { desc }; }),
      createComputePipeline: jest.fn((desc) => { pipelines.push(desc); return { desc }; }),
      queue: { writeBuffer: jest.fn() },
    };
  });

  test('createSplatStorageBuffer uses STORAGE|COPY_DST and uploads data', () => {
    const packed = packSplats(oneSplat());
    const buf = createSplatStorageBuffer(device, packed);
    expect(buf.desc.size).toBe(packed.byteLength);
    expect(buf.desc.usage & GPUBufferUsage.STORAGE).toBeTruthy();
    expect(buf.desc.usage & GPUBufferUsage.COPY_DST).toBeTruthy();
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(buf, 0, packed);
  });

  test('createSortBuffers pads to power-of-two and sizes u32 entries', () => {
    const { indexBuffer, keyBuffer, paddedCount } = createSortBuffers(device, 1000);
    expect(paddedCount).toBe(1024);
    expect(indexBuffer.desc.size).toBe(1024 * 4);
    expect(keyBuffer.desc.size).toBe(1024 * 4);
    expect(indexBuffer.desc.usage & GPUBufferUsage.STORAGE).toBeTruthy();
  });

  test('createSplatRenderPipeline is a blended triangle-strip with no depth', () => {
    createSplatRenderPipeline(device, 'WGSL', 'bgra8unorm');
    const desc = pipelines[0];
    expect(desc.primitive.topology).toBe('triangle-strip');
    expect(desc.depthStencil).toBeUndefined();
    expect(desc.fragment.targets[0].blend).toBeDefined();
    expect(desc.fragment.targets[0].format).toBe('bgra8unorm');
  });

  test('createSplatDebugPipeline is a point-list with no blend', () => {
    createSplatDebugPipeline(device, 'WGSL', 'bgra8unorm');
    const desc = pipelines[0];
    expect(desc.primitive.topology).toBe('point-list');
    expect(desc.vertex.entryPoint).toBe('vs_debug_points');
    expect(desc.fragment.targets[0].blend).toBeUndefined();
  });

  test('createSortPipelines builds key-gen + bitonic-step compute pipelines', () => {
    const { keys, step } = createSortPipelines(device, 'WGSL');
    expect(device.createComputePipeline).toHaveBeenCalledTimes(2);
    expect(keys.desc.compute.entryPoint).toBe('compute_keys');
    expect(step.desc.compute.entryPoint).toBe('bitonic_step');
  });
});
