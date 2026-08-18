import { createCornellBoxScene } from '../scripts/engine/raytracing/core/cornell-box.js';
import { validateRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';

describe('Cornell Box scene', () => {
  test('uses shared quad/cube geometry and deterministic instances', () => {
    const scene = createCornellBoxScene();
    expect(validateRayScene(scene)).toEqual({ ok: true, errors: [] });
    expect(scene.geometries).toHaveLength(2);
    expect(scene.instances).toHaveLength(8);
    expect(scene.materials).toHaveLength(4);
    expect(scene.lights).toHaveLength(1);
    const triangleCount = scene.instances.reduce(
      (sum, instance) => sum + scene.geometries[instance.geometryIndex].indices.length / 3,
      0,
    );
    expect(triangleCount).toBe(36);
    expect(scene.instances[5].geometryIndex).toBe(1);
    expect(scene.instances[6].geometryIndex).toBe(1);
    expect(scene.bounds.min[0]).toBeCloseTo(-1);
    expect(scene.bounds.max[1]).toBeCloseTo(2);
  });
});
