import { initShaderProgram } from '../scripts/engine/webgl-helpers.js';

// Mock WebGL context
const mockGl = {
  createShader: jest.fn(() => 'shader'),
  shaderSource: jest.fn(),
  compileShader: jest.fn(),
  getShaderParameter: jest.fn(() => true),
  deleteShader: jest.fn(),
  createProgram: jest.fn(() => 'program'),
  attachShader: jest.fn(),
  linkProgram: jest.fn(),
  getProgramParameter: jest.fn(() => true),
  getShaderInfoLog: jest.fn(() => 'info log'),
  getProgramInfoLog: jest.fn(() => 'info log'),
  VERTEX_SHADER: 'VERTEX_SHADER',
  FRAGMENT_SHADER: 'FRAGMENT_SHADER',
  COMPILE_STATUS: 'COMPILE_STATUS',
  LINK_STATUS: 'LINK_STATUS',
};

// Mock document
global.document = {
  querySelector: jest.fn(() => ({
    textContent: '',
    style: {
      display: 'none',
    },
  })),
};

describe('WebGL Helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
  test('initShaderProgram should return a shader program on success', () => {
    mockGl.getShaderParameter.mockReturnValue(true);
    mockGl.getProgramParameter.mockReturnValue(true);
    const vsSource = 'vertex shader';
    const fsSource = 'fragment shader';
    const shaderProgram = initShaderProgram(mockGl, vsSource, fsSource);
    expect(shaderProgram).toBe('program');
  });

  test('initShaderProgram should return null on vertex shader compile error', () => {
    mockGl.getShaderParameter = jest.fn().mockImplementationOnce(() => false).mockImplementationOnce(() => true);
    const vsSource = 'vertex shader';
    const fsSource = 'fragment shader';
    const shaderProgram = initShaderProgram(mockGl, vsSource, fsSource);
    expect(shaderProgram).toBeNull();
  });

  test('initShaderProgram should return null on fragment shader compile error', () => {
    mockGl.getShaderParameter = jest.fn().mockImplementationOnce(() => true).mockImplementationOnce(() => false);
    const vsSource = 'vertex shader';
    const fsSource = 'fragment shader';
    const shaderProgram = initShaderProgram(mockGl, vsSource, fsSource);
    expect(shaderProgram).toBeNull();
  });

  test('initShaderProgram should return null on program link error', () => {
    mockGl.getShaderParameter.mockReturnValue(true);
    mockGl.getProgramParameter = jest.fn(() => false);
    const vsSource = 'vertex shader';
    const fsSource = 'fragment shader';
    const shaderProgram = initShaderProgram(mockGl, vsSource, fsSource);
    expect(shaderProgram).toBeNull();
  });
});
