import { extractFrustumPlanes, viewProjection, aabbInFrustum } from '../scripts/engine/ordering/spatial/frustum.js';
import { createPerspectiveMatrix, createLookAtMatrix } from '../scripts/engine/matrix.js';

// Camera at (0,0,5) looking at the origin down -z; 45° fov, aspect 1, near 0.1, far 100.
function cameraVP() {
  const proj = createPerspectiveMatrix((45 * Math.PI) / 180, 1, 0.1, 100);
  const view = createLookAtMatrix([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  return viewProjection(proj, view);
}

function box(cx, cy, cz, h = 0.5) {
  return { min: [cx - h, cy - h, cz - h], max: [cx + h, cy + h, cz + h] };
}

describe('extractFrustumPlanes', () => {
  test('returns six normalized planes', () => {
    const planes = extractFrustumPlanes(cameraVP());
    expect(planes).toHaveLength(6);
    for (const [a, b, c] of planes) {
      expect(Math.hypot(a, b, c)).toBeCloseTo(1, 5);
    }
  });
});

describe('aabbInFrustum — visibility against a known camera', () => {
  const planes = extractFrustumPlanes(cameraVP());

  test('box at the origin is visible', () => {
    const b = box(0, 0, 0);
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(true);
  });

  test('box behind the camera is culled', () => {
    const b = box(0, 0, 8); // z > eye.z (5) → behind
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(false);
  });

  test('box far off to the right is culled', () => {
    const b = box(100, 0, 0);
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(false);
  });

  test('box far above is culled', () => {
    const b = box(0, 100, 0);
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(false);
  });

  test('box beyond the far plane is culled', () => {
    const b = box(0, 0, -200); // past far=100 from eye at z=5
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(false);
  });

  test('box just in front of the camera is visible', () => {
    const b = box(0, 0, 3); // between near and origin
    expect(aabbInFrustum(planes, b.min, b.max)).toBe(true);
  });

  test('a huge box enclosing the frustum is kept (conservative)', () => {
    expect(aabbInFrustum(planes, [-1000, -1000, -1000], [1000, 1000, 1000])).toBe(true);
  });
});
