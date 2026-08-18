import { buildMedianBvh } from '../scripts/engine/raytracing/acceleration/bvh-builder.js';

function record(id, x) {
  return { id, min: [x - 0.25,-1,-1], max: [x + 0.25,1,1], centroid: [x,0,0] };
}

function verifyNode(nodes, references, nodeIndex = 0) {
  const node = nodes[nodeIndex];
  if (node.primitiveCount > 0) {
    expect(node.primitiveCount).toBeLessThanOrEqual(4);
    expect(node.leftFirst + node.primitiveCount).toBeLessThanOrEqual(references.length);
    return;
  }
  expect(node.leftFirst + 1).toBeLessThan(nodes.length);
  for (const childIndex of [node.leftFirst, node.leftFirst + 1]) {
    const child = nodes[childIndex];
    for (let axis = 0; axis < 3; axis += 1) {
      expect(child.min[axis]).toBeGreaterThanOrEqual(node.min[axis]);
      expect(child.max[axis]).toBeLessThanOrEqual(node.max[axis]);
    }
    verifyNode(nodes, references, childIndex);
  }
}

describe('deterministic median BVH', () => {
  test('returns an empty structure for no records', () => {
    const bvh = buildMedianBvh([]);
    expect(bvh.nodes).toEqual([]);
    expect(bvh.leafReferences).toEqual(new Uint32Array());
    expect(bvh.maxDepth).toBe(0);
  });

  test('uses consecutive children and bounded leaves', () => {
    const bvh = buildMedianBvh([7,2,9,1,8,3,6,4,5].map((id) => record(id, id)));
    expect(bvh.nodes[0].primitiveCount).toBe(0);
    expect(bvh.nodes[0].leftFirst).toBe(1);
    verifyNode(bvh.nodes, bvh.leafReferences);
    expect([...bvh.leafReferences].sort((a,b) => a-b)).toEqual([1,2,3,4,5,6,7,8,9]);
  });

  test('is deterministic and breaks equal-centroid ties by id', () => {
    const records = [record(4, 0), record(1, 0), record(3, 0), record(2, 0), record(0, 0)];
    const first = buildMedianBvh(records);
    const second = buildMedianBvh(records);
    expect(first.nodes).toEqual(second.nodes);
    expect([...first.leafReferences]).toEqual([0,1,2,3,4]);
    expect(first.leafReferences).toEqual(second.leafReferences);
  });

  test('rejects invalid records rather than building corrupt bounds', () => {
    expect(() => buildMedianBvh([{ id: 0, min: [0,0,0], max: [NaN,1,1], centroid: [0,0,0] }]))
      .toThrow(/finite/);
    expect(() => buildMedianBvh([record(1, 0), record(1, 2)])).toThrow(/duplicated/);
  });
});

