/**
 * @file Loose octree over splat centers, built once at load.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Pure (no GPU): recursively subdivides the scene AABB into octants until a node
 * holds ≤ maxLeafSplats (or maxDepth is hit), grouping splats by leaf. The second
 * spatial structure the Culled reduction prototypes against the uniform grid
 * (see docs/splat-ordering.md); it adapts resolution to where splats actually are,
 * so it culls tighter on clustered/elongated scenes.
 *
 * Node shape: { min, max, children, start, count }
 *   - internal: children = [8 node indices | -1 for empty octant], start = -1
 *   - leaf:     children = null, [start, start+count) is its slice of splatOrder
 */

const MIN_EXTENT = 1e-6;

/**
 * @param {Float32Array|number[]} positions xyz triples, length >= 3*count
 * @param {number} count splat count
 * @param {{maxLeafSplats?: number, maxDepth?: number}} [opts]
 * @returns {{ nodes: object[], splatOrder: Uint32Array, maxLeafSplats: number, maxDepth: number }}
 */
export function buildOctree(positions, count, { maxLeafSplats = 64, maxDepth = 8 } = {}) {
    if (!count || count < 0) {
        return { nodes: [], splatOrder: new Uint32Array(0), maxLeafSplats, maxDepth };
    }

    // Root AABB over centers.
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const v = positions[i * 3 + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    // Guard degenerate extents so subdivision has a nonzero box to split.
    for (let k = 0; k < 3; k++) {
        if (max[k] - min[k] < MIN_EXTENT) max[k] = min[k] + MIN_EXTENT;
    }

    const nodes = [];
    const splatOrder = new Uint32Array(count);
    let cursor = 0;

    function build(idx, lo, hi, depth) {
        const nodeIndex = nodes.length;
        nodes.push(null); // reserve slot (children may append before we fill it)

        if (idx.length <= maxLeafSplats || depth >= maxDepth) {
            const start = cursor;
            for (let i = 0; i < idx.length; i++) splatOrder[cursor++] = idx[i];
            nodes[nodeIndex] = { min: lo.slice(), max: hi.slice(), children: null, start, count: idx.length };
            return nodeIndex;
        }

        const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        const buckets = [[], [], [], [], [], [], [], []];
        for (let i = 0; i < idx.length; i++) {
            const s = idx[i];
            const oct = (positions[s * 3] >= mid[0] ? 1 : 0)
                | (positions[s * 3 + 1] >= mid[1] ? 2 : 0)
                | (positions[s * 3 + 2] >= mid[2] ? 4 : 0);
            buckets[oct].push(s);
        }

        const children = new Array(8).fill(-1);
        for (let o = 0; o < 8; o++) {
            if (buckets[o].length === 0) continue;
            const clo = [(o & 1) ? mid[0] : lo[0], (o & 2) ? mid[1] : lo[1], (o & 4) ? mid[2] : lo[2]];
            const chi = [(o & 1) ? hi[0] : mid[0], (o & 2) ? hi[1] : mid[1], (o & 4) ? hi[2] : mid[2]];
            children[o] = build(buckets[o], clo, chi, depth + 1);
        }
        nodes[nodeIndex] = { min: lo.slice(), max: hi.slice(), children, start: -1, count: idx.length };
        return nodeIndex;
    }

    const rootIdx = new Array(count);
    for (let i = 0; i < count; i++) rootIdx[i] = i;
    build(rootIdx, min, max, 0);

    return { nodes, splatOrder, maxLeafSplats, maxDepth };
}
