import { createIdentityMatrix, rotateMatrix, translateMatrix } from '../scripts/engine/matrix.js';
import {
  createEmptyRayScene, validateRayScene, prepareRayScene,
  computeGeometryBounds, computeInstanceBounds,
} from '../scripts/engine/raytracing/core/ray-scene.js';

function triangleGeometry() {
  return {
    id: 4, revision: 0,
    positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]),
    indices: new Uint16Array([0,1,2]),
  };
}

describe('RayScene', () => {
  test('creates and prepares an empty scene', () => {
    const scene = createEmptyRayScene();
    expect(validateRayScene(scene)).toEqual({ ok: true, errors: [] });
    expect(prepareRayScene(scene).bounds.radius).toBe(0);
  });

  test('prepares typed local geometry and two shared instances', () => {
    const a = createIdentityMatrix();
    const b = createIdentityMatrix();
    translateMatrix(b, [3, 0, 0]);
    const prepared = prepareRayScene({
      geometries: [triangleGeometry()],
      instances: [
        { id: 0, geometryIndex: 0, materialIndex: 0, worldMatrix: a },
        { id: 1, geometryIndex: 0, materialIndex: 0, worldMatrix: b },
      ],
      materials: [{ baseColor: [1,1,1,1] }],
    });
    expect(prepared.geometries).toHaveLength(1);
    expect(prepared.geometries[0].indices).toBeInstanceOf(Uint32Array);
    expect(prepared.instances).toHaveLength(2);
    expect(prepared.bounds.max[0]).toBeCloseTo(4);
  });

  test('instance bounds transform all eight corners', () => {
    const bounds = computeGeometryBounds(new Float32Array([-1,-1,-1, 1,1,1]));
    const transform = createIdentityMatrix();
    rotateMatrix(transform, Math.PI / 4, [0, 1, 0]);
    const world = computeInstanceBounds(bounds, transform);
    expect(world.min[0]).toBeCloseTo(-Math.SQRT2);
    expect(world.max[0]).toBeCloseTo(Math.SQRT2);
    expect(world.min[2]).toBeCloseTo(-Math.SQRT2);
  });

  test('validation reports stable aggregate errors', () => {
    const invalid = {
      geometries: [{ ...triangleGeometry(), id: -1, indices: [9, 1, 2] }],
      instances: [{ id: 0, geometryIndex: 2, materialIndex: 1, worldMatrix: new Float32Array(16) }],
      materials: [],
    };
    const result = validateRayScene(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Geometry 0.id must be a non-negative integer.',
      'Geometry 0.indices[0] is out of range.',
      'Instance 0.geometryIndex is out of range.',
      'Instance 0.materialIndex is out of range.',
      'Instance 0.worldMatrix must be invertible.',
    ]));
    expect(() => prepareRayScene(invalid)).toThrow(/Invalid RayScene/);
  });
});
