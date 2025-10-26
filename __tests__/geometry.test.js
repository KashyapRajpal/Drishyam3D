import { initCubeBuffers, createDefaultCube, createSphere } from '../scripts/engine/geometry.js';

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
