import { buildOctree } from '../scripts/engine/ordering/spatial/octree.js';

function isPermutation(splatOrder, count) {
  if (splatOrder.length !== count) return false;
  const seen = new Uint8Array(count);
  for (const v of splatOrder) {
    if (v >= count || seen[v]) return false;
    seen[v] = 1;
  }
  return true;
}

function leaves(tree) {
  return tree.nodes.filter((n) => n.children === null);
}

function randomPositions(count, seed = 1) {
  const positions = new Float32Array(count * 3);
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < count * 3; i++) positions[i] = rand() * 20 - 10;
  return positions;
}

describe('buildOctree — structure invariants', () => {
  test('empty cloud yields no nodes', () => {
    const t = buildOctree(new Float32Array(0), 0);
    expect(t.nodes).toHaveLength(0);
    expect(t.splatOrder.length).toBe(0);
  });

  test('splatOrder is a permutation of all splat indices', () => {
    const count = 500;
    const t = buildOctree(randomPositions(count), count, { maxLeafSplats: 16 });
    expect(isPermutation(t.splatOrder, count)).toBe(true);
  });

  test('leaf splat ranges tile [0, count) without overlap', () => {
    const count = 500;
    const t = buildOctree(randomPositions(count), count, { maxLeafSplats: 16 });
    const ls = leaves(t).sort((a, b) => a.start - b.start);
    let expected = 0;
    for (const leaf of ls) {
      expect(leaf.start).toBe(expected);
      expected += leaf.count;
    }
    expect(expected).toBe(count);
  });

  test('small cloud (≤ maxLeafSplats) is a single leaf holding everything', () => {
    const count = 10;
    const t = buildOctree(randomPositions(count), count, { maxLeafSplats: 64 });
    expect(t.nodes).toHaveLength(1);
    expect(t.nodes[0].children).toBeNull();
    expect(t.nodes[0].count).toBe(count);
  });
});

describe('buildOctree — spatial containment', () => {
  test('every splat lies within its leaf AABB', () => {
    const count = 400;
    const positions = randomPositions(count, 9);
    const t = buildOctree(positions, count, { maxLeafSplats: 16 });
    for (const leaf of leaves(t)) {
      for (let k = leaf.start; k < leaf.start + leaf.count; k++) {
        const s = t.splatOrder[k];
        for (let axis = 0; axis < 3; axis++) {
          const p = positions[s * 3 + axis];
          expect(p).toBeGreaterThanOrEqual(leaf.min[axis] - 1e-4);
          expect(p).toBeLessThanOrEqual(leaf.max[axis] + 1e-4);
        }
      }
    }
  });

  test('non-degenerate cloud actually subdivides', () => {
    const count = 400;
    const t = buildOctree(randomPositions(count), count, { maxLeafSplats: 16 });
    expect(t.nodes.length).toBeGreaterThan(1);
    expect(leaves(t).length).toBeGreaterThan(1);
  });
});

describe('buildOctree — degenerate clouds', () => {
  test('coincident points terminate at maxDepth without infinite recursion', () => {
    const count = 300; // all identical → never partition
    const positions = new Float32Array(count * 3).fill(2);
    const t = buildOctree(positions, count, { maxLeafSplats: 8, maxDepth: 5 });
    expect(isPermutation(t.splatOrder, count)).toBe(true);
    // Terminates: every leaf sits at the depth cap and holds everything funneled to it.
    const ls = leaves(t);
    expect(ls.length).toBeGreaterThanOrEqual(1);
    let total = 0;
    for (const leaf of ls) total += leaf.count;
    expect(total).toBe(count);
  });
});
