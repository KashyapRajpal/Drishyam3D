import {
  initCubeBuffers,
  createDefaultCube,
  createDefaultTexturedCube,
  createSphere,
  createTexturedSphere,
  generateCubeData,
  generateSphereData,
} from '../scripts/engine/geometry.js';

// Mock WebGL context
const mockGl = {
  createBuffer: jest.fn(() => 'buffer'),
  bindBuffer: jest.fn(),
  bufferData: jest.fn(),
  createTexture: jest.fn(() => 'texture'),
  bindTexture: jest.fn(),
  texImage2D: jest.fn(),
  generateMipmap: jest.fn(),
  texParameteri: jest.fn(),
  RGBA: 'RGBA',
  UNSIGNED_BYTE: 'UNSIGNED_BYTE',
  TEXTURE_2D: 'TEXTURE_2D',
  CLAMP_TO_EDGE: 'CLAMP_TO_EDGE',
  LINEAR: 'LINEAR',
  STATIC_DRAW: 'STATIC_DRAW',
  ARRAY_BUFFER: 'ARRAY_BUFFER',
  ELEMENT_ARRAY_BUFFER: 'ELEMENT_ARRAY_BUFFER',
  UNSIGNED_SHORT: 'UNSIGNED_SHORT',
};

describe('Geometry Functions', () => {

  test('initCubeBuffers should return an object with buffer properties', () => {
    const buffers = initCubeBuffers(mockGl);
    expect(buffers).toHaveProperty('position');
    expect(buffers).toHaveProperty('normal');
    expect(buffers).toHaveProperty('texCoord');
    expect(buffers).toHaveProperty('indices');
  });

  test('createDefaultCube should return a cube object', () => {
    const cube = createDefaultCube(mockGl);
    expect(cube).toHaveProperty('buffers');
    expect(cube).toHaveProperty('texture', null);
    expect(cube).toHaveProperty('vertexCount', 36);
    expect(cube).toHaveProperty('indexType', 'UNSIGNED_SHORT');
  });

  test('createSphere should return a sphere object', () => {
    const sphere = createSphere(mockGl);
    expect(sphere).toHaveProperty('buffers');
    expect(sphere).toHaveProperty('texture', null);
    expect(sphere).toHaveProperty('vertexCount');
    expect(sphere).toHaveProperty('indexType', 'UNSIGNED_SHORT');
  });

});

describe('generateCubeData', () => {

  test('returns typed arrays of the correct types', () => {
    const data = generateCubeData();
    expect(data.positions).toBeInstanceOf(Float32Array);
    expect(data.normals).toBeInstanceOf(Float32Array);
    expect(data.texCoords).toBeInstanceOf(Float32Array);
    expect(data.indices).toBeInstanceOf(Uint16Array);
  });

  test('returns 36 indices for a cube (6 faces × 2 triangles × 3 vertices)', () => {
    const { indices, vertexCount } = generateCubeData();
    expect(indices.length).toBe(36);
    expect(vertexCount).toBe(36);
  });

  test('returns 24 vertices worth of position data (6 faces × 4 vertices × 3 components)', () => {
    const { positions } = generateCubeData();
    expect(positions.length).toBe(24 * 3);
  });

  test('returns 24 vertices worth of normal data', () => {
    const { normals } = generateCubeData();
    expect(normals.length).toBe(24 * 3);
  });

  test('returns 24 vertices worth of texcoord data (2 components each)', () => {
    const { texCoords } = generateCubeData();
    expect(texCoords.length).toBe(24 * 2);
  });

  test('all normals are unit vectors', () => {
    const { normals } = generateCubeData();
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.sqrt(normals[i] ** 2 + normals[i+1] ** 2 + normals[i+2] ** 2);
      expect(len).toBeCloseTo(1.0, 5);
    }
  });

  test('all index values are within bounds of vertex count', () => {
    const { indices, positions } = generateCubeData();
    const vertexCount = positions.length / 3;
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertexCount);
    }
  });

});

describe('generateSphereData', () => {

  test('returns typed arrays of the correct types', () => {
    const data = generateSphereData();
    expect(data.positions).toBeInstanceOf(Float32Array);
    expect(data.normals).toBeInstanceOf(Float32Array);
    expect(data.texCoords).toBeInstanceOf(Float32Array);
    expect(data.indices).toBeInstanceOf(Uint16Array);
  });

  test('vertexCount matches indices length', () => {
    const { indices, vertexCount } = generateSphereData();
    expect(vertexCount).toBe(indices.length);
  });

  test('all normals are unit vectors', () => {
    const { normals } = generateSphereData(1, 10, 10);
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.sqrt(normals[i] ** 2 + normals[i+1] ** 2 + normals[i+2] ** 2);
      expect(len).toBeCloseTo(1.0, 5);
    }
  });

  test('all positions are at the specified radius', () => {
    const radius = 2.5;
    const { positions } = generateSphereData(radius, 10, 10);
    for (let i = 0; i < positions.length; i += 3) {
      const dist = Math.sqrt(positions[i] ** 2 + positions[i+1] ** 2 + positions[i+2] ** 2);
      expect(dist).toBeCloseTo(radius, 4);
    }
  });

  test('all index values are within bounds of vertex count', () => {
    const { indices, positions } = generateSphereData(1, 10, 10);
    const vertexCount = positions.length / 3;
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertexCount);
    }
  });

  test('honours custom radius, latitudeBands, longitudeBands', () => {
    const small = generateSphereData(1, 5, 5);
    const large = generateSphereData(1, 20, 20);
    expect(large.indices.length).toBeGreaterThan(small.indices.length);
  });

});

describe('Textured geometry (WebGL)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful image load
    global.Image = class {
      constructor() {
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };
  });

  test('createDefaultTexturedCube resolves with a cube that has a texture', async () => {
    const cube = await createDefaultTexturedCube(mockGl);
    expect(cube).toHaveProperty('buffers');
    expect(cube).toHaveProperty('vertexCount', 36);
    // Texture should be set (the mock returns 'texture')
    expect(cube.texture).toBeTruthy();
  });

  test('createDefaultTexturedCube falls back to untextured cube on texture load failure', async () => {
    global.Image = class {
      constructor() {
        setTimeout(() => this.onerror && this.onerror(), 0);
      }
    };
    const cube = await createDefaultTexturedCube(mockGl);
    expect(cube).toHaveProperty('buffers');
    expect(cube).toHaveProperty('vertexCount', 36);
    // Falls back gracefully — still a valid drawable
    expect(cube).toHaveProperty('indexType', 'UNSIGNED_SHORT');
  });

  test('createTexturedSphere resolves with a sphere that has a texture', async () => {
    const sphere = await createTexturedSphere(mockGl);
    expect(sphere).toHaveProperty('buffers');
    expect(sphere.texture).toBeTruthy();
  });

  test('createTexturedSphere falls back to untextured sphere on texture load failure', async () => {
    global.Image = class {
      constructor() {
        setTimeout(() => this.onerror && this.onerror(), 0);
      }
    };
    const sphere = await createTexturedSphere(mockGl);
    expect(sphere).toHaveProperty('buffers');
    expect(sphere).toHaveProperty('texture', null);
  });

});
