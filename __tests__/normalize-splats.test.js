import { normalizeInPlace } from '../scripts/engine/ply-loader.js';

/** Minimal parsed-cloud shape: positions + scales + bounds are all normalize touches. */
function cloud(positions, scales) {
  const count = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) { cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2]; }
  cx /= count; cy /= count; cz /= count;
  let radius = 0;
  for (let i = 0; i < count; i++) {
    radius = Math.max(radius, Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz));
  }
  return {
    positions: Float32Array.from(positions),
    scales: Float32Array.from(scales ?? new Array(count * 3).fill(1)),
    rotations: Float32Array.from(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0))),
    count,
    bounds: { center: [cx, cy, cz], radius },
  };
}

describe('normalizeInPlace', () => {
  test('centers on the origin with radius 1', () => {
    // Offset far from the origin and much smaller than unit scale — the shape
    // the cluster-fly captures actually have (radius ~0.18).
    const c = cloud([10, 5, -3, 10.2, 5, -3, 10, 5.2, -3, 10, 5, -2.8]);
    const before = c.bounds.radius;
    normalizeInPlace(c);

    expect(c.bounds.center).toEqual([0, 0, 0]);
    expect(c.bounds.radius).toBe(1);
    expect(c.sourceTransform.radius).toBeCloseTo(before);

    // Every splat now sits within the unit sphere, and the farthest touches it.
    let maxDist = 0;
    for (let i = 0; i < c.count; i++) {
      maxDist = Math.max(maxDist, Math.hypot(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]));
    }
    expect(maxDist).toBeCloseTo(1, 5);
  });

  test('scales move with positions so gaussians keep their proportions', () => {
    const c = cloud([0, 0, 0, 2, 0, 0], [0.5, 0.5, 0.5, 0.25, 0.25, 0.25]);
    const radius = c.bounds.radius; // 1
    normalizeInPlace(c);
    expect(c.scales[0]).toBeCloseTo(0.5 / radius);
    expect(c.scales[3]).toBeCloseTo(0.25 / radius);
  });

  test('a splat radius relative to the cloud is preserved exactly', () => {
    // The invariant that matters: a gaussian covering 10% of the cloud before
    // must still cover 10% after, or normalization is visible on screen.
    const c = cloud([0, 0, 0, 6, 0, 0, 0, 6, 0], [0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2]);
    const ratioBefore = c.scales[0] / c.bounds.radius;
    normalizeInPlace(c);
    expect(c.scales[0] / c.bounds.radius).toBeCloseTo(ratioBefore, 6);
  });

  test('rotations are untouched (uniform scale commutes with rotation)', () => {
    const c = cloud([0, 0, 0, 1, 1, 1]);
    const before = Array.from(c.rotations);
    normalizeInPlace(c);
    expect(Array.from(c.rotations)).toEqual(before);
  });

  test('preserves the original frame for mapping back to world space', () => {
    const c = cloud([10, 5, -3, 10.2, 5, -3, 10, 5.2, -3]);
    const { center, radius } = { center: [...c.bounds.center], radius: c.bounds.radius };
    const p0 = [c.positions[0], c.positions[1], c.positions[2]];
    normalizeInPlace(c);

    const t = c.sourceTransform;
    expect(t.center.map((v) => +v.toFixed(5))).toEqual(center.map((v) => +v.toFixed(5)));
    expect(t.radius).toBeCloseTo(radius);
    // Undoing the transform recovers the original position.
    const back = [0, 1, 2].map((k) => c.positions[k] * t.radius + t.center[k]);
    expect(back[0]).toBeCloseTo(p0[0], 4);
    expect(back[1]).toBeCloseTo(p0[1], 4);
    expect(back[2]).toBeCloseTo(p0[2], 4);
  });

  test('a degenerate cloud is left alone rather than divided by zero', () => {
    const c = cloud([1, 1, 1, 1, 1, 1]); // all coincident ⇒ radius 0
    normalizeInPlace(c);
    expect(Number.isFinite(c.positions[0])).toBe(true);
    expect(c.positions[0]).toBe(1);
    expect(c.sourceTransform).toBeUndefined();
  });
});
