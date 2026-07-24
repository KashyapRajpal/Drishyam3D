/**
 * @file Uniform grid over splat centers, built once at load.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Pure (no GPU): buckets splats into a dim³ uniform grid and returns flat arrays
 * the GPU frustum-cull pass consumes — splats grouped by cell (`splatOrder`) plus
 * per-cell prefix offsets (`cellStart`). One of the two spatial structures the
 * Culled reduction prototypes (see docs/splat-ordering.md).
 */

// Floor for cell extents so a degenerate (flat/point) cloud never yields a
// zero-width cell (which would divide by zero when assigning splats).
const MIN_EXTENT = 1e-6;

/**
 * Build a uniform grid over splat centers.
 * @param {Float32Array|number[]} positions xyz triples, length >= 3*count
 * @param {number} count splat count
 * @param {{dim?: number}} [opts] cells per axis (default 16)
 * @returns {{
 *   dim: number, min: number[], cellSize: number[], cellCount: number,
 *   cellStart: Uint32Array, splatOrder: Uint32Array,
 * }}
 *   `cellStart` has length cellCount+1 (exclusive prefix sum; last = count).
 *   `splatOrder` is a permutation of [0, count) grouped by cell.
 */
export function buildGrid(positions, count, { dim = 16 } = {}) {
    dim = Math.max(1, dim | 0);
    const cellCount = dim * dim * dim;

    if (!count || count < 0) {
        return {
            dim, min: [0, 0, 0], cellSize: [1, 1, 1], cellCount,
            cellStart: new Uint32Array(cellCount + 1),
            splatOrder: new Uint32Array(0),
        };
    }

    // AABB over centers.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const min = [minX, minY, minZ];
    const cellSize = [
        Math.max((maxX - minX) / dim, MIN_EXTENT),
        Math.max((maxY - minY) / dim, MIN_EXTENT),
        Math.max((maxZ - minZ) / dim, MIN_EXTENT),
    ];

    // First pass: cell index per splat + histogram.
    const cellOf = new Uint32Array(count);
    const counts = new Uint32Array(cellCount);
    for (let i = 0; i < count; i++) {
        const cx = clampCell((positions[i * 3] - minX) / cellSize[0], dim);
        const cy = clampCell((positions[i * 3 + 1] - minY) / cellSize[1], dim);
        const cz = clampCell((positions[i * 3 + 2] - minZ) / cellSize[2], dim);
        const cell = (cz * dim + cy) * dim + cx;
        cellOf[i] = cell;
        counts[cell]++;
    }

    // Exclusive prefix sum → cellStart (length cellCount+1; last = count).
    const cellStart = new Uint32Array(cellCount + 1);
    for (let c = 0; c < cellCount; c++) cellStart[c + 1] = cellStart[c] + counts[c];

    // Scatter splat ids grouped by cell.
    const cursor = cellStart.slice(0, cellCount);
    const splatOrder = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        const c = cellOf[i];
        splatOrder[cursor[c]++] = i;
    }

    return { dim, min, cellSize, cellCount, cellStart, splatOrder };
}

function clampCell(t, dim) {
    const c = Math.floor(t);
    if (c < 0) return 0;
    if (c >= dim) return dim - 1;
    return c;
}

/**
 * World-space AABB of a linear cell index (row-major x, then y, then z).
 * Used by the cull pass and tests.
 * @returns {{min: number[], max: number[]}}
 */
export function cellAABB(grid, cellIndex) {
    const { dim, min, cellSize } = grid;
    const cx = cellIndex % dim;
    const cy = Math.floor(cellIndex / dim) % dim;
    const cz = Math.floor(cellIndex / (dim * dim));
    return {
        min: [min[0] + cx * cellSize[0], min[1] + cy * cellSize[1], min[2] + cz * cellSize[2]],
        max: [min[0] + (cx + 1) * cellSize[0], min[1] + (cy + 1) * cellSize[1], min[2] + (cz + 1) * cellSize[2]],
    };
}
