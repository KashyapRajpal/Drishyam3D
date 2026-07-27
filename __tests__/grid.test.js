import { buildGrid, cellAABB } from '../scripts/engine/ordering/spatial/grid.js';

/** Assert splatOrder is a permutation of [0, count). */
function isPermutation(splatOrder, count) {
  if (splatOrder.length !== count) return false;
  const seen = new Uint8Array(count);
  for (const v of splatOrder) {
    if (v >= count || seen[v]) return false;
    seen[v] = 1;
  }
  return true;
}

describe('buildGrid — structure invariants', () => {
  test('empty cloud yields empty splatOrder and zeroed prefix', () => {
    const g = buildGrid(new Float32Array(0), 0, { dim: 4 });
    expect(g.cellCount).toBe(64);
    expect(g.splatOrder.length).toBe(0);
    expect(g.cellStart.length).toBe(65);
    expect(g.cellStart[64]).toBe(0);
  });

  test('cellStart is a monotonic exclusive prefix ending at count', () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0.5, 0.5, 0.5,
    ]);
    const g = buildGrid(positions, 5, { dim: 3 });
    expect(g.cellStart[0]).toBe(0);
    expect(g.cellStart[g.cellCount]).toBe(5);
    for (let c = 0; c < g.cellCount; c++) {
      expect(g.cellStart[c + 1]).toBeGreaterThanOrEqual(g.cellStart[c]);
    }
  });

  test('splatOrder is a permutation of all splat indices', () => {
    const count = 200;
    const positions = new Float32Array(count * 3);
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < count * 3; i++) positions[i] = rand() * 10 - 5;
    const g = buildGrid(positions, count, { dim: 8 });
    expect(isPermutation(g.splatOrder, count)).toBe(true);
  });
});

describe('buildGrid — cell assignment', () => {
  test('two corner splats land in opposite corner cells (dim=2)', () => {
    // AABB [0,1]³, cellSize 0.5. splat0 → cell (0,0,0)=0; splat1 → (1,1,1)=7.
    const positions = new Float32Array([0, 0, 0, 1, 1, 1]);
    const g = buildGrid(positions, 2, { dim: 2 });
    expect(g.cellStart[1]).toBe(1);        // cell 0 has exactly splat 0
    expect(g.cellStart[7]).toBe(1);        // cells 1..6 empty
    expect(g.cellStart[8]).toBe(2);        // cell 7 holds splat 1
    expect(Array.from(g.splatOrder)).toEqual([0, 1]);
  });

  test('dim=1 puts every splat in the single cell', () => {
    const positions = new Float32Array([0, 0, 0, 5, 5, 5, -3, 2, 1]);
    const g = buildGrid(positions, 3, { dim: 1 });
    expect(g.cellCount).toBe(1);
    expect(g.cellStart[1]).toBe(3);
    expect(isPermutation(g.splatOrder, 3)).toBe(true);
  });

  test('every splat lies within the AABB of its assigned cell', () => {
    const count = 64;
    const positions = new Float32Array(count * 3);
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < count * 3; i++) positions[i] = rand() * 4 - 2;
    const dim = 4;
    const g = buildGrid(positions, count, { dim });

    // Invert splatOrder → cell per splat via cellStart ranges.
    for (let cell = 0; cell < g.cellCount; cell++) {
      const box = cellAABB(g, cell);
      for (let k = g.cellStart[cell]; k < g.cellStart[cell + 1]; k++) {
        const s = g.splatOrder[k];
        const px = positions[s * 3], py = positions[s * 3 + 1], pz = positions[s * 3 + 2];
        // Allow a tiny epsilon on the far edge (clamped last cell is inclusive).
        expect(px).toBeGreaterThanOrEqual(box.min[0] - 1e-5);
        expect(px).toBeLessThanOrEqual(box.max[0] + 1e-5);
        expect(py).toBeGreaterThanOrEqual(box.min[1] - 1e-5);
        expect(py).toBeLessThanOrEqual(box.max[1] + 1e-5);
        expect(pz).toBeGreaterThanOrEqual(box.min[2] - 1e-5);
        expect(pz).toBeLessThanOrEqual(box.max[2] + 1e-5);
      }
    }
  });
});

describe('buildGrid — degenerate clouds', () => {
  test('coincident points produce no NaN and a positive cell size', () => {
    const positions = new Float32Array([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const g = buildGrid(positions, 3, { dim: 8 });
    expect(g.cellSize.every((s) => s > 0 && Number.isFinite(s))).toBe(true);
    // All three collapse into the same cell.
    let nonEmpty = 0;
    for (let c = 0; c < g.cellCount; c++) {
      if (g.cellStart[c + 1] - g.cellStart[c] > 0) nonEmpty++;
    }
    expect(nonEmpty).toBe(1);
    expect(isPermutation(g.splatOrder, 3)).toBe(true);
  });
});
