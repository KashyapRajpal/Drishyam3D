import { invertMatrix } from '../scripts/engine/matrix.js';
import { buildAccelerationStructures, updateAccelerationStructures } from '../scripts/engine/raytracing/acceleration/acceleration-structure.js';
import { createCornellBoxScene } from '../scripts/engine/raytracing/core/cornell-box.js';
import { prepareRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';
import {
  BVH_NODE_OFFSETS, BVH_NODE_SIZE,
  FRAME_FLAG_HAS_TLAS, FRAME_UNIFORM_OFFSETS, FRAME_UNIFORM_SIZE,
  INSTANCE_OFFSETS, INSTANCE_SIZE, INVALID_INDEX,
  MATERIAL_OFFSETS, MATERIAL_SIZE,
  TRIANGLE_OFFSETS, TRIANGLE_SIZE,
  VERTEX_OFFSETS, VERTEX_SIZE,
  packFrameUniforms,
} from '../scripts/engine/raytracing/gpu/gpu-ray-layout.js';
import { packGpuScene, repackGpuTlasAndInstances } from '../scripts/engine/raytracing/gpu/gpu-scene-packer.js';

function view(buffer) { return new DataView(buffer); }
function f32(data, offset) { return data.getFloat32(offset, true); }
function u32(data, offset) { return data.getUint32(offset, true); }

describe('GPU ray scene packer', () => {
  test('packs unique Cornell geometry and exact vertex/triangle/material fields', () => {
    const scene = createCornellBoxScene();
    const acceleration = buildAccelerationStructures(scene);
    const packed = packGpuScene(scene, acceleration);
    expect(packed.metadata).toMatchObject({
      vertexCount: 28, triangleCount: 14, instanceCount: 8, materialCount: 4,
      tlasNodeCount: 3, tlasLeafCount: 8, blasNodeOffset: 3, blasLeafOffset: 8,
    });
    expect(packed.buffers.vertices.byteLength).toBe(28 * VERTEX_SIZE);
    expect(packed.buffers.triangles.byteLength).toBe(14 * TRIANGLE_SIZE);
    expect(packed.buffers.instances.byteLength).toBe(8 * INSTANCE_SIZE);
    expect(packed.buffers.materials.byteLength).toBe(4 * MATERIAL_SIZE);

    const vertices = view(packed.buffers.vertices);
    expect(f32(vertices, VERTEX_OFFSETS.position)).toBeCloseTo(-0.5);
    expect(f32(vertices, VERTEX_OFFSETS.position + 4)).toBeCloseTo(-0.5);
    expect(f32(vertices, VERTEX_OFFSETS.normal + 8)).toBeCloseTo(1);
    expect(f32(vertices, VERTEX_OFFSETS.texCoord)).toBeCloseTo(0);
    expect(f32(vertices, 44)).toBe(0);

    const triangles = view(packed.buffers.triangles);
    expect([0,4,8].map((offset) => u32(triangles, TRIANGLE_OFFSETS.i0 + offset))).toEqual([0,1,2]);
    expect(u32(triangles, TRIANGLE_OFFSETS.geometryIndex)).toBe(0);
    const firstCubeTriangle = 2 * TRIANGLE_SIZE;
    expect(u32(triangles, firstCubeTriangle + TRIANGLE_OFFSETS.i0)).toBe(4);
    expect(u32(triangles, firstCubeTriangle + TRIANGLE_OFFSETS.geometryIndex)).toBe(1);

    const materials = view(packed.buffers.materials);
    expect(f32(materials, MATERIAL_OFFSETS.baseColor)).toBeCloseTo(0.73);
    const emitter = 3 * MATERIAL_SIZE;
    expect(f32(materials, emitter + MATERIAL_OFFSETS.emissive)).toBeCloseTo(1);
    expect(f32(materials, emitter + MATERIAL_OFFSETS.emissive + 12)).toBeCloseTo(15);
    expect(u32(materials, MATERIAL_OFFSETS.textureIndex)).toBe(INVALID_INDEX);
  });

  test('packs TLAS first, rebases BLAS nodes/leaves, and shares BLAS roots', () => {
    const scene = createCornellBoxScene();
    const acceleration = buildAccelerationStructures(scene);
    const packed = packGpuScene(scene, acceleration);
    const nodes = view(packed.buffers.bvhNodes);
    const leaves = view(packed.buffers.bvhLeafReferences);
    const instances = view(packed.buffers.instances);
    const ranges = packed.metadata.geometryRanges;
    expect(ranges[0].blasNodeOffset).toBe(3);
    expect(ranges[1].blasNodeOffset).toBe(4);
    expect(u32(instances, INSTANCE_OFFSETS.blasRoot)).toBe(3);
    expect(u32(instances, 5 * INSTANCE_SIZE + INSTANCE_OFFSETS.blasRoot)).toBe(4);
    expect(u32(instances, 6 * INSTANCE_SIZE + INSTANCE_OFFSETS.blasRoot)).toBe(4);
    expect(u32(instances, 5 * INSTANCE_SIZE + INSTANCE_OFFSETS.geometryIndex)).toBe(1);
    expect(u32(instances, 3 * INSTANCE_SIZE + INSTANCE_OFFSETS.materialIndex)).toBe(1);
    expect(u32(instances, INSTANCE_OFFSETS.flags)).toBe(0);

    const cubeRoot = ranges[1].blasNodeOffset * BVH_NODE_SIZE;
    expect(u32(nodes, cubeRoot + BVH_NODE_OFFSETS.primitiveCount)).toBe(0);
    expect(u32(nodes, cubeRoot + BVH_NODE_OFFSETS.leftFirst)).toBeGreaterThan(ranges[1].blasNodeOffset);
    const firstCubeLeaf = ranges[1].blasLeafOffset;
    expect(u32(leaves, firstCubeLeaf * 4)).toBeGreaterThanOrEqual(ranges[1].triangleOffset);
    expect([...new Uint32Array(packed.buffers.bvhLeafReferences, 0, 8)].sort((a,b) => a-b)).toEqual([0,1,2,3,4,5,6,7]);
  });

  test('packs every frame-uniform field at its documented byte offset', () => {
    const buffer = packFrameUniforms({
      cameraFrame: {
        eye: [1,2,3], right: [4,5,6], up: [7,8,9], forward: [10,11,12], tanHalfFovY: 13,
      },
      width: 14, height: 15, sampleIndex: 16, frameSeed: 17,
      maxBounces: 18, samplesPerFrame: 19, lightType: 'rect', flags: FRAME_FLAG_HAS_TLAS,
      rayEpsilon: 20, exposure: 21, environmentIntensity: 22, environment: [23,24,25],
      light: { center: [26,27,28], intensity: 29, u: [30,31,32], v: [33,34,35], color: [36,37,38] },
    });
    expect(buffer.byteLength).toBe(FRAME_UNIFORM_SIZE);
    const data = view(buffer);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.cameraPosition + o))).toEqual([1,2,3]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.cameraRight + o))).toEqual([4,5,6]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.cameraUp + o))).toEqual([7,8,9]);
    expect([0,4,8,12].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.cameraForward + o))).toEqual([10,11,12,13]);
    expect([0,4,8,12].map((o) => u32(data, FRAME_UNIFORM_OFFSETS.dimensions + o))).toEqual([14,15,16,17]);
    expect([0,4,8,12].map((o) => u32(data, FRAME_UNIFORM_OFFSETS.renderSettings + o))).toEqual([18,19,2,1]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.numerical + o))).toEqual([20,21,22]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.environment + o))).toEqual([23,24,25]);
    expect([0,4,8,12].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.lightPosition + o))).toEqual([26,27,28,29]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.lightU + o))).toEqual([30,31,32]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.lightV + o))).toEqual([33,34,35]);
    expect([0,4,8].map((o) => f32(data, FRAME_UNIFORM_OFFSETS.lightColor + o))).toEqual([36,37,38]);
  });

  test('repacking a transform changes only TLAS prefixes and instances', () => {
    const firstScene = createCornellBoxScene();
    const firstAcceleration = buildAccelerationStructures(firstScene, { revisions: { instanceRevision: 0 } });
    const packed = packGpuScene(firstScene, firstAcceleration);
    const originalObjects = { ...packed.buffers };
    const originalNodes = new Uint8Array(packed.buffers.bvhNodes).slice();
    const originalLeaves = new Uint8Array(packed.buffers.bvhLeafReferences).slice();
    const originalInstances = new Uint8Array(packed.buffers.instances).slice();

    const worldMatrices = firstScene.instances.map((instance) => new Float32Array(instance.worldMatrix));
    worldMatrices[5][12] += 0.2;
    const nextScene = {
      ...firstScene,
      instances: firstScene.instances.map((instance, index) => ({
        ...instance,
        worldMatrix: worldMatrices[index],
        inverseWorldMatrix: invertMatrix(worldMatrices[index]),
      })),
    };
    const nextAcceleration = updateAccelerationStructures(firstAcceleration, nextScene, { instanceRevision: 1 });
    const ranges = repackGpuTlasAndInstances(packed, nextScene, nextAcceleration);
    expect(packed.buffers.vertices).toBe(originalObjects.vertices);
    expect(packed.buffers.triangles).toBe(originalObjects.triangles);
    expect(packed.buffers.materials).toBe(originalObjects.materials);
    expect(new Uint8Array(packed.buffers.bvhNodes).slice(ranges.nodeByteLength)).toEqual(originalNodes.slice(ranges.nodeByteLength));
    expect(new Uint8Array(packed.buffers.bvhLeafReferences).slice(ranges.leafByteLength)).toEqual(originalLeaves.slice(ranges.leafByteLength));
    expect(new Uint8Array(packed.buffers.instances)).not.toEqual(originalInstances);
  });

  test('TLAS-only repacking rejects changed static inputs', () => {
    const scene = createCornellBoxScene();
    const acceleration = buildAccelerationStructures(scene);
    const packed = packGpuScene(scene, acceleration);
    expect(() => repackGpuTlasAndInstances(
      packed,
      { ...scene, geometries: [...scene.geometries] },
      acceleration,
    )).not.toThrow();
    expect(() => repackGpuTlasAndInstances(
      packed,
      { ...scene, geometries: scene.geometries.map((geometry) => ({ ...geometry })) },
      acceleration,
    )).toThrow(/unchanged geometry/);
    expect(() => repackGpuTlasAndInstances(
      packed,
      { ...scene, materials: scene.materials.map((material) => ({ ...material })) },
      acceleration,
    )).toThrow(/unchanged geometry/);
  });

  test('empty scenes expose zero logical counts and nonzero allocation metadata', () => {
    const scene = prepareRayScene({ geometries: [], instances: [], materials: [] });
    const packed = packGpuScene(scene, buildAccelerationStructures(scene));
    expect(packed.metadata).toMatchObject({ vertexCount: 0, triangleCount: 0, nodeCount: 0, leafCount: 0, instanceCount: 0 });
    expect(Object.values(packed.metadata.logicalByteLengths).every((value) => value === 0)).toBe(true);
    expect(Object.values(packed.metadata.allocationByteLengths).every((value) => value > 0)).toBe(true);
  });

  test('rejects invalid references/non-finite data and never mutates source arrays', () => {
    const scene = createCornellBoxScene();
    const acceleration = buildAccelerationStructures(scene);
    const positionsBefore = scene.geometries[0].positions.slice();
    const nodesBefore = acceleration.tlas.nodes.map((node) => ({ ...node, min: [...node.min], max: [...node.max] }));
    packGpuScene(scene, acceleration);
    expect(scene.geometries[0].positions).toEqual(positionsBefore);
    expect(acceleration.tlas.nodes).toEqual(nodesBefore);

    const badScene = { ...scene, geometries: [...scene.geometries] };
    badScene.geometries[0] = { ...scene.geometries[0], positions: scene.geometries[0].positions.slice() };
    badScene.geometries[0].positions[0] = NaN;
    expect(() => packGpuScene(badScene, acceleration)).toThrow(/finite/);
    const badAcceleration = { ...acceleration, tlas: { ...acceleration.tlas, instanceIndices: new Uint32Array([99]) } };
    expect(() => packGpuScene(scene, badAcceleration)).toThrow(/out of range/);
    const badNodes = acceleration.tlas.nodes.map((node) => ({ ...node }));
    badNodes[0].leftFirst = badNodes.length;
    expect(() => packGpuScene(scene, { ...acceleration, tlas: { ...acceleration.tlas, nodes: badNodes } })).toThrow(/child reference/);
  });
});
