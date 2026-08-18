import { createIdentityMatrix } from '../scripts/engine/matrix.js';
import { buildAccelerationStructures } from '../scripts/engine/raytracing/acceleration/acceleration-structure.js';
import { createRng, nextFloat, nextUint32, ZERO_SEED_FALLBACK } from '../scripts/engine/raytracing/core/random.js';
import { prepareRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';
import {
  linearRgbToRgba8,
  linearToSrgb,
  reinhardToneMap,
  srgbToLinear,
  traceSample,
} from '../scripts/engine/raytracing/cpu/path-integrator.js';

function squareGeometry(id, halfExtent) {
  return {
    id, revision: 0,
    positions: new Float32Array([
      -halfExtent,-halfExtent,0, halfExtent,-halfExtent,0,
      halfExtent,halfExtent,0, -halfExtent,halfExtent,0,
    ]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]),
    indices: new Uint32Array([0,1,2, 0,2,3]),
  };
}

function translated(x, y, z) {
  const matrix = createIdentityMatrix();
  matrix[12] = x; matrix[13] = y; matrix[14] = z;
  return matrix;
}

function directLightScene(occluded) {
  const geometries = [squareGeometry(0, 2)];
  const instances = [{ id: 0, geometryIndex: 0, materialIndex: 0, worldMatrix: createIdentityMatrix() }];
  if (occluded) {
    geometries.push(squareGeometry(1, 0.3));
    instances.push({ id: 1, geometryIndex: 1, materialIndex: 1, worldMatrix: translated(0.5, 0, 1) });
  }
  return prepareRayScene({
    geometries,
    instances,
    materials: [{ baseColor: [0.8,0.8,0.8,1] }, { baseColor: [0.2,0.2,0.2,1] }],
    lights: [{
      type: 'rect', center: [1,0,2], u: [0.05,0,0], v: [0,-0.05,0],
      color: [1,1,1], intensity: 20,
    }],
    environment: { color: [0,0,0] },
  });
}

describe('seeded CPU path integrator', () => {
  test('xorshift32 matches the fixed ten-state vector', () => {
    const rng = createRng(0x12345678);
    const expected = [
      0x87985aa5, 0x155b24a3, 0x4820f4c4, 0x81b3ac98, 0x703a0788,
      0x29a8e24d, 0x89ca4f1d, 0xc5186e29, 0xd37862a7, 0x3ab14b11,
    ];
    expect(expected.map(() => nextUint32(rng))).toEqual(expected);
    expect(createRng(0).state).toBe(ZERO_SEED_FALLBACK);
    const uniform = nextFloat(createRng(0x12345678));
    expect(uniform).toBeGreaterThanOrEqual(0);
    expect(uniform).toBeLessThan(1);
  });

  test('returns the environment on a miss', () => {
    const scene = prepareRayScene({
      geometries: [], instances: [], materials: [], environment: { color: [0.1,0.2,0.3] },
    });
    expect(traceSample(
      { origin: [0,0,0], direction: [0,0,-1] },
      scene,
      buildAccelerationStructures(scene),
      createRng(1),
    )).toEqual([0.1,0.2,0.3]);
  });

  test('shows primary emission', () => {
    const scene = prepareRayScene({
      geometries: [squareGeometry(0, 1)],
      instances: [{ id: 0, geometryIndex: 0, materialIndex: 0, worldMatrix: createIdentityMatrix() }],
      materials: [{ baseColor: [1,1,1,1], emissive: [1,0.5,0.25], emissiveStrength: 4 }],
    });
    expect(traceSample(
      { origin: [0,0,2], direction: [0,0,-1] }, scene,
      buildAccelerationStructures(scene), createRng(2), { maxBounces: 1 },
    )).toEqual([4,2,1]);
  });

  test('an unoccluded receiver is brighter than a shadowed receiver', () => {
    const visibleScene = directLightScene(false);
    const blockedScene = directLightScene(true);
    const ray = { origin: [0,0,1.5], direction: [0,0,-1] };
    const visible = traceSample(ray, visibleScene, buildAccelerationStructures(visibleScene), createRng(7), { maxBounces: 1 });
    const blocked = traceSample(ray, blockedScene, buildAccelerationStructures(blockedScene), createRng(7), { maxBounces: 1 });
    expect(visible[0]).toBeGreaterThan(0);
    expect(blocked[0]).toBeLessThan(visible[0] * 0.01);
  });

  test('seeded paths are repeatable, finite, and color conversion is bounded', () => {
    const scene = directLightScene(false);
    const acceleration = buildAccelerationStructures(scene);
    const ray = { origin: [0,0,1.5], direction: [0,0,-1] };
    const first = traceSample(ray, scene, acceleration, createRng(99));
    const second = traceSample(ray, scene, acceleration, createRng(99));
    expect(first).toEqual(second);
    expect(first.every(Number.isFinite)).toBe(true);
    expect(reinhardToneMap(1)).toBe(0.5);
    expect(srgbToLinear(linearToSrgb(0.25))).toBeCloseTo(0.25, 8);
    expect([...linearRgbToRgba8([0,1,100], new Uint8ClampedArray(4))]).toEqual([0,188,254,255]);
  });
});
