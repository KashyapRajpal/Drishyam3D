import { prepareRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';
import {
  buildAccelerationStructures,
  updateAccelerationStructures,
} from '../scripts/engine/raytracing/acceleration/acceleration-structure.js';
import { buildTlas } from '../scripts/engine/raytracing/acceleration/tlas-builder.js';
import { intersectSceneBruteForce, intersectTlas } from '../scripts/engine/raytracing/acceleration/intersections.js';

function sharedGeometry(revision = 0) {
  return {
    id: 10,
    revision,
    positions: new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]),
    indices: new Uint32Array([0,1,2, 0,2,3]),
  };
}

function planarMatrix(sx, sy, angle, tx, ty, tz) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([
    c*sx, s*sx, 0, 0,
    -s*sy, c*sy, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ]);
}

function tiltedMatrix(tx, tz) {
  const c = Math.cos(0.5), s = Math.sin(0.5);
  return new Float32Array([
    c*1.4, 0, -s*1.4, 0,
    0, 0.6, 0, 0,
    s, 0, c, 0,
    tx, 0, tz, 1,
  ]);
}

function scene(instanceOffset = 0, geometryRevision = 0) {
  return prepareRayScene({
    geometries: [sharedGeometry(geometryRevision)],
    instances: [
      { id: 20, geometryIndex: 0, materialIndex: 0, worldMatrix: planarMatrix(1,1,0,instanceOffset,0,0) },
      { id: 21, geometryIndex: 0, materialIndex: 1, worldMatrix: planarMatrix(2,0.5,0.4,3,0,-2) },
      { id: 22, geometryIndex: 0, materialIndex: 2, worldMatrix: planarMatrix(-1,1,-0.2,-3,0,-4) },
      { id: 23, geometryIndex: 0, materialIndex: 0, worldMatrix: tiltedMatrix(0,-6) },
    ],
    materials: [{}, {}, {}],
  });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('TLAS and acceleration lifetime', () => {
  test('stores world-space instance references and valid children', () => {
    const prepared = scene();
    const acceleration = buildAccelerationStructures(prepared);
    const tlas = buildTlas(prepared, acceleration.blases);
    expect([...tlas.instanceIndices].sort((a,b) => a-b)).toEqual([0,1,2,3]);
    expect(tlas.nodes).toHaveLength(1);
    expect(tlas.nodes[0].primitiveCount).toBe(4);
    expect(tlas.nodes[0].min[0]).toBeLessThanOrEqual(-4);
    expect(tlas.diagnostics.stackSafe).toBe(true);
  });

  test('matches the brute-force oracle for 1,000 seeded world rays', () => {
    const prepared = scene();
    const acceleration = buildAccelerationStructures(prepared);
    const random = seededRandom(0x12345678);
    for (let i = 0; i < 1000; i += 1) {
      const origin = [(random() * 12) - 6, (random() * 5) - 2.5, 5];
      const target = [(random() * 8) - 4, (random() * 3) - 1.5, -7 * random()];
      const delta = target.map((value, axis) => value - origin[axis]);
      const length = Math.hypot(...delta);
      const ray = { origin, direction: delta.map((value) => value / length) };
      const expected = intersectSceneBruteForce(ray, prepared, 1e-4, 100);
      const actual = intersectTlas(ray, prepared, acceleration, 1e-4, 100);
      expect(actual?.instanceIndex ?? null).toBe(expected?.instanceIndex ?? null);
      expect(actual?.triangleIndex ?? null).toBe(expected?.triangleIndex ?? null);
      if (actual) {
        expect(actual.t).toBeCloseTo(expected.t, 6);
        expect(actual.materialIndex).toBe(expected.materialIndex);
        expect(actual.frontFace).toBe(expected.frontFace);
        expect(actual.geometricNormal).toEqual(expect.arrayContaining(expected.geometricNormal));
      }
    }
  });

  test('transform-only updates rebuild TLAS and reuse exact BLAS objects', () => {
    const firstScene = scene();
    const first = buildAccelerationStructures(firstScene, {
      revisions: { geometryRevision: 0, instanceRevision: 0 },
    });
    const transformed = updateAccelerationStructures(first, scene(0.5), {
      geometryRevision: 0,
      instanceRevision: 1,
    });
    expect(transformed.blases[0]).toBe(first.blases[0]);
    expect(transformed.tlas).not.toBe(first.tlas);

    const geometryEdited = updateAccelerationStructures(transformed, scene(0.5, 1), {
      geometryRevision: 1,
      instanceRevision: 1,
    });
    expect(geometryEdited.blases[0]).not.toBe(first.blases[0]);
    expect(geometryEdited.tlas).not.toBe(transformed.tlas);
  });

  test('non-geometry revisions reuse both acceleration levels', () => {
    const first = buildAccelerationStructures(scene(), {
      revisions: { geometryRevision: 0, instanceRevision: 0 },
    });
    const materialOnly = updateAccelerationStructures(first, scene(), {
      geometryRevision: 0,
      instanceRevision: 0,
      materialRevision: 1,
    });
    expect(materialOnly.blases[0]).toBe(first.blases[0]);
    expect(materialOnly.tlas).toBe(first.tlas);
  });

  test('an empty scene has an empty TLAS and always misses', () => {
    const empty = prepareRayScene({ geometries: [], instances: [], materials: [] });
    const acceleration = buildAccelerationStructures(empty);
    expect(acceleration.tlas.nodes).toEqual([]);
    expect(intersectTlas({ origin: [0,0,0], direction: [0,0,-1] }, empty, acceleration, 0, 10)).toBeNull();
  });
});
