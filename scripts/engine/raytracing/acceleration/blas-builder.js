import { buildMedianBvh } from './bvh-builder.js';

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function triangleRecord(geometry, triangleIndex) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const indexOffset = triangleIndex * 3;
    for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = geometry.indices[indexOffset + corner];
        const positionOffset = vertexIndex * 3;
        for (let axis = 0; axis < 3; axis += 1) {
            const value = geometry.positions[positionOffset + axis];
            if (!Number.isFinite(value)) throw new Error(`Triangle ${triangleIndex} contains a non-finite position.`);
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
        }
    }
    return {
        id: triangleIndex,
        min,
        max,
        centroid: min.map((value, axis) => (value + max[axis]) * 0.5),
    };
}

export function buildBlas(geometry, geometryIndex, options = {}) {
    if (!geometry || !Number.isInteger(geometryIndex) || geometryIndex < 0) {
        throw new Error('buildBlas requires geometry and a non-negative geometry index.');
    }
    if (geometry.indices.length % 3 !== 0) throw new Error('Geometry indices must contain complete triangles.');
    const start = now();
    const records = [];
    for (let triangleIndex = 0; triangleIndex < geometry.indices.length / 3; triangleIndex += 1) {
        records.push(triangleRecord(geometry, triangleIndex));
    }
    const built = buildMedianBvh(records, options);
    if (!built.diagnostics.stackSafe) {
        throw new Error(`BLAS ${geometryIndex} depth ${built.maxDepth} exceeds the 64-entry traversal stack.`);
    }
    return {
        geometryIndex,
        geometryId: geometry.id,
        geometryRevision: geometry.revision,
        nodes: built.nodes,
        triangleIndices: built.leafReferences,
        maxDepth: built.maxDepth,
        leafCount: built.leafCount,
        buildMs: now() - start,
        diagnostics: built.diagnostics,
    };
}

