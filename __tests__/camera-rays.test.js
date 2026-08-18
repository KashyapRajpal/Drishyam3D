import { createCameraFrame, generateCameraRay } from '../scripts/engine/raytracing/core/camera-rays.js';

describe('camera ray generation', () => {
  test('center pixel points at target', () => {
    const frame = createCameraFrame({
      eye: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0],
      fovY: Math.PI / 2, aspect: 1,
    });
    const ray = generateCameraRay(frame, 1, 1, 3, 3, [0.5, 0.5]);
    expect(ray.origin).toEqual([0, 0, 5]);
    expect(ray.direction[0]).toBeCloseTo(0);
    expect(ray.direction[1]).toBeCloseTo(0);
    expect(ray.direction[2]).toBeCloseTo(-1);
  });

  test('top-left ray has negative x and positive y', () => {
    const frame = createCameraFrame({
      eye: [0, 0, 0], target: [0, 0, -1], up: [0, 1, 0],
      fovY: Math.PI / 2, aspect: 1,
    });
    const ray = generateCameraRay(frame, 0, 0, 2, 2, [0, 0]);
    expect(ray.direction[0]).toBeLessThan(0);
    expect(ray.direction[1]).toBeGreaterThan(0);
    expect(Math.hypot(...ray.direction)).toBeCloseTo(1);
  });

  test('rejects degenerate camera frames', () => {
    expect(() => createCameraFrame({
      eye: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fovY: 1, aspect: 1,
    })).toThrow(/forward/i);
    expect(() => createCameraFrame({
      eye: [0, 0, 1], target: [0, 0, 0], up: [0, 0, 1], fovY: 1, aspect: 1,
    })).toThrow(/parallel/i);
  });
});
