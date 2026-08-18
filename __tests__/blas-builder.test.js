import { buildBlas } from '../scripts/engine/raytracing/acceleration/blas-builder.js';
import {
  intersectBlas,
  intersectGeometryBruteForce,
} from '../scripts/engine/raytracing/acceleration/intersections.js';

function geometry() {
  return {
    id: 7,
    revision: 2,
    positions: new Float32Array([
      -1,-1,0, 0,-1,0, 0,1,0,
       0,-1,0, 1,-1,0, 0,1,0,
      -1,-1,-2, 0,-1,-2, 0,1,-2,
       0,-1,-2, 1,-1,-2, 0,1,-2,
      -0.2,-0.2,1, 0.2,-0.2,1, 0,0.2,1,
    ]),
    normals: new Float32Array(45).fill(0),
    indices: new Uint32Array([0,1,2, 3,4,5, 6,7,8, 9,10,11, 12,13,14]),
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('BLAS builder and traversal', () => {
  test('builds one reference per triangle and preserves metadata', () => {
    const blas = buildBlas(geometry(), 3);
    expect(blas.geometryIndex).toBe(3);
    expect(blas.geometryId).toBe(7);
    expect(blas.geometryRevision).toBe(2);
    expect([...blas.triangleIndices].sort((a,b) => a-b)).toEqual([0,1,2,3,4]);
    expect(blas.diagnostics.stackSafe).toBe(true);
  });

  test('matches brute force for 1,000 deterministic rays', () => {
    const mesh = geometry();
    // Give interpolation valid normals while retaining geometric fallback coverage elsewhere.
    for (let i = 2; i < mesh.normals.length; i += 3) mesh.normals[i] = 1;
    const blas = buildBlas(mesh, 0);
    const random = seededRandom(0xdecafbad);
    for (let i = 0; i < 1000; i += 1) {
      const ray = {
        origin: [(random() * 4) - 2, (random() * 4) - 2, 3],
        direction: [(random() - 0.5) * 0.2, (random() - 0.5) * 0.2, -1],
      };
      const expected = intersectGeometryBruteForce(ray, mesh, 1e-4, 100);
      const actual = intersectBlas(ray, mesh, blas, 1e-4, 100);
      expect(actual?.triangleIndex ?? null).toBe(expected?.triangleIndex ?? null);
      if (actual) expect(actual.t).toBeCloseTo(expected.t, 7);
    }
  });

  test('supports empty geometry and any-hit traversal', () => {
    const empty = { ...geometry(), positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() };
    const emptyBlas = buildBlas(empty, 0);
    expect(emptyBlas.nodes).toEqual([]);
    expect(intersectBlas({ origin: [0,0,1], direction: [0,0,-1] }, empty, emptyBlas, 0, 10)).toBeNull();
    const mesh = geometry();
    expect(intersectBlas(
      { origin: [0,0,3], direction: [0,0,-1] }, mesh, buildBlas(mesh, 0), 0, 10, true,
    )).not.toBeNull();
  });
});

