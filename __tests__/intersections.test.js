import { createIdentityMatrix } from '../scripts/engine/matrix.js';
import { prepareRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';
import {
  intersectAabb,
  intersectGeometryBruteForce,
  intersectSceneBruteForce,
  intersectTriangle,
} from '../scripts/engine/raytracing/acceleration/intersections.js';

function triangleGeometry(overrides = {}) {
  return {
    id: 0,
    revision: 0,
    positions: new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]),
    indices: new Uint32Array([0,1,2]),
    ...overrides,
  };
}

function singleInstanceScene(worldMatrix = createIdentityMatrix(), geometry = triangleGeometry()) {
  return prepareRayScene({
    geometries: [geometry],
    instances: [{ id: 0, geometryIndex: 0, materialIndex: 0, worldMatrix }],
    materials: [{ baseColor: [1,1,1,1] }],
  });
}

describe('ray intersections', () => {
  test('slab AABB handles entry, inside origins, parallel rays, and exclusive tMax', () => {
    const boundsMin = [-1,-1,-1], boundsMax = [1,1,1];
    expect(intersectAabb({ origin: [0,0,3], direction: [0,0,-1] }, boundsMin, boundsMax, 0, 10)).toBe(2);
    expect(intersectAabb({ origin: [0,0,0], direction: [1,0,0] }, boundsMin, boundsMax, 0.25, 10)).toBe(0.25);
    expect(intersectAabb({ origin: [2,0,0], direction: [0,1,0] }, boundsMin, boundsMax, 0, 10)).toBeNull();
    expect(intersectAabb({ origin: [0,0,3], direction: [0,0,-1] }, boundsMin, boundsMax, 0, 2)).toBeNull();
  });

  test('triangle test reports closest two-sided hits and barycentrics', () => {
    const geometry = triangleGeometry();
    const front = intersectTriangle({ origin: [0,0,2], direction: [0,0,-1] }, geometry, 0, 0, 10);
    expect(front.t).toBeCloseTo(2);
    expect(front.frontFace).toBe(true);
    expect(front.barycentric.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(front.geometricNormal).toEqual([0,0,1]);
    const back = intersectTriangle({ origin: [0,0,-2], direction: [0,0,1] }, geometry, 0, 0, 10);
    expect(back.frontFace).toBe(false);
    expect(back.geometricNormal).toEqual([0,0,1]);
    expect(back.shadingNormal).toEqual([0,0,-1]);
  });

  test('accepts edge hits and rejects misses, self hits, parallel rays, and degenerates', () => {
    const geometry = triangleGeometry();
    expect(intersectTriangle({ origin: [0,-1,1], direction: [0,0,-1] }, geometry, 0, 0, 3)).not.toBeNull();
    expect(intersectTriangle({ origin: [2,0,1], direction: [0,0,-1] }, geometry, 0, 0, 3)).toBeNull();
    expect(intersectTriangle({ origin: [0,0,0], direction: [0,0,1] }, geometry, 0, 1e-4, 3)).toBeNull();
    expect(intersectTriangle({ origin: [0,0,1], direction: [1,0,0] }, geometry, 0, 0, 3)).toBeNull();
    const degenerate = triangleGeometry({
      positions: new Float32Array([0,0,0, 1,0,0, 2,0,0]),
    });
    expect(intersectTriangle({ origin: [0,0,1], direction: [0,0,-1] }, degenerate, 0, 0, 3)).toBeNull();
  });

  test('brute force returns the closest triangle', () => {
    const geometry = triangleGeometry({
      positions: new Float32Array([
        -1,-1,0, 1,-1,0, 0,1,0,
        -1,-1,-2, 1,-1,-2, 0,1,-2,
      ]),
      normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1]),
      indices: new Uint32Array([0,1,2, 3,4,5]),
    });
    const hit = intersectGeometryBruteForce({ origin: [0,0,2], direction: [0,0,-1] }, geometry, 0, 10);
    expect(hit.triangleIndex).toBe(0);
    expect(hit.t).toBeCloseTo(2);
  });

  test('preserves world t under non-uniform scale and transforms normals by inverse transpose', () => {
    const transform = new Float32Array([
      2,0,0,0,
      0,1,0,0,
      0,0,0.5,0,
      0,0,-3,1,
    ]);
    const scene = singleInstanceScene(transform);
    const hit = intersectSceneBruteForce({ origin: [0,0,1], direction: [0,0,-1] }, scene, 1e-4, 20);
    expect(hit.t).toBeCloseTo(4);
    expect(hit.position).toEqual([0,0,-3]);
    expect(hit.geometricNormal).toEqual([0,0,1]);
    expect(hit.instanceIndex).toBe(0);
    expect(hit.materialIndex).toBe(0);
  });

  test('inverse transpose preserves a slanted surface normal under non-uniform scale', () => {
    const inverseSqrt2 = 1 / Math.sqrt(2);
    const geometry = triangleGeometry({
      positions: new Float32Array([0,0,0, 1,0,0, 0,1,1]),
      normals: new Float32Array([
        0,-inverseSqrt2,inverseSqrt2,
        0,-inverseSqrt2,inverseSqrt2,
        0,-inverseSqrt2,inverseSqrt2,
      ]),
    });
    const transform = new Float32Array([
      2,0,0,0,
      0,1,0,0,
      0,0,0.5,0,
      0,0,0,1,
    ]);
    const expectedNormal = [0, -1 / Math.sqrt(5), 2 / Math.sqrt(5)];
    const target = [0.5, 0.25, 0.125];
    const ray = {
      origin: target.map((value, axis) => value + expectedNormal[axis] * 2),
      direction: expectedNormal.map((value) => -value),
    };
    const hit = intersectSceneBruteForce(ray, singleInstanceScene(transform, geometry), 1e-4, 10);
    expect(hit.t).toBeCloseTo(2);
    hit.geometricNormal.forEach((value, axis) => expect(value).toBeCloseTo(expectedNormal[axis], 6));
    hit.shadingNormal.forEach((value, axis) => expect(value).toBeCloseTo(expectedNormal[axis], 6));
  });

  test('mirrored transforms reverse world winding and any-hit exits with a valid hit', () => {
    const mirrored = new Float32Array([
      -1,0,0,0,
      0,1,0,0,
      0,0,1,0,
      0,0,0,1,
    ]);
    const scene = singleInstanceScene(mirrored);
    const hit = intersectSceneBruteForce({ origin: [0,0,2], direction: [0,0,-1] }, scene, 1e-4, 10, true);
    expect(hit.frontFace).toBe(false);
    expect(hit.geometricNormal).toEqual([0,0,-1]);
    expect(hit.shadingNormal).toEqual([0,0,1]);
  });
});
