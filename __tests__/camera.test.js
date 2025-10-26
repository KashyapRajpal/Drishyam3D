import { Camera } from '../scripts/engine/camera.js';
import { createLookAtMatrix } from '../scripts/engine/matrix.js';

// Mock canvas
const mockCanvas = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
  }),
};

describe('Camera', () => {
  let camera;

  beforeEach(() => {
    camera = new Camera(mockCanvas);
  });

  test('should initialize with default values', () => {
    expect(camera.position).toEqual([0, 0, 5]);
    expect(camera.target).toEqual([0, 0, 0]);
    expect(camera.up).toEqual([0, 1, 0]);
    expect(camera.zoom).toBe(5);
    expect(camera.rotation).toEqual({ x: 0, y: 0 });
  });

  test('updateViewMatrix should update the view matrix', () => {
    const initialViewMatrix = camera.getViewMatrix();
    camera.zoom = 10;
    camera.rotation.y = Math.PI / 4;
    camera.updateViewMatrix();
    const updatedViewMatrix = camera.getViewMatrix();
    expect(updatedViewMatrix).not.toEqual(initialViewMatrix);
  });

  test('getViewMatrix should return the current view matrix', () => {
    const eye = [0, 0, 5];
    const target = [0, 0, 0];
    const up = [0, 1, 0];
    camera.updateViewMatrix();
    const expectedMatrix = createLookAtMatrix(eye, target, up);
    const actualMatrix = camera.getViewMatrix();
    for (let i = 0; i < expectedMatrix.length; i++) {
        expect(actualMatrix[i]).toBeCloseTo(expectedMatrix[i]);
    }
  });
});
