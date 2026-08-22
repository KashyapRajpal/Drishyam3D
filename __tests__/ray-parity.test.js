import { createCameraFrame } from '../scripts/engine/raytracing/core/camera-rays.js';
import { compareLinearRgba, linearLuminanceSsim, linearRgbRmse } from '../scripts/engine/raytracing/core/image-metrics.js';
import { prepareRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';
import { renderCpuReference } from '../scripts/engine/raytracing/cpu/cpu-reference-renderer.js';

describe('ray tracing parity helpers', () => {
  test('renders a deterministic linear CPU reference with the shared sample contract', () => {
    const scene = prepareRayScene({
      geometries: [],
      instances: [],
      materials: [],
      environment: { color: [0.25, 0.5, 0.75] },
    });
    const cameraFrame = createCameraFrame({
      eye: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], fovY: Math.PI / 4, aspect: 2,
    });
    const options = {
      scene, cameraFrame, width: 2, height: 1,
      settings: { seed: 0x12345678, spp: 3, maxBounces: 2, environmentIntensity: 2 },
    };
    const first = renderCpuReference(options);
    const second = renderCpuReference(options);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ width: 2, height: 1, spp: 3 });
    expect([...first.data]).toEqual([0.5, 1, 1.5, 1, 0.5, 1, 1.5, 1]);
  });

  test('reports zero error for identical images and detects structured drift', () => {
    const reference = new Float32Array([
      0, 0, 0, 1,
      1, 1, 1, 1,
    ]);
    const drifted = new Float32Array([
      0, 0, 0, 1,
      0.5, 0.5, 0.5, 1,
    ]);

    expect(linearRgbRmse(reference, reference)).toBe(0);
    expect(linearLuminanceSsim(reference, reference)).toBeCloseTo(1, 12);
    expect(compareLinearRgba(reference, drifted)).toMatchObject({
      rmse: Math.sqrt(0.125),
      dynamicRange: 1,
    });
    expect(compareLinearRgba(reference, drifted).ssim).toBeLessThan(1);
    expect(() => linearRgbRmse(reference, new Float32Array(4))).toThrow(/equal-length/);
  });
});
