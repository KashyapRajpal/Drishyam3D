import { computeGeometryBounds, computeInstanceBounds } from '../core/ray-scene.js';
import { buildMedianBvh } from './bvh-builder.js';

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export function buildTlas(scene, blases, options = {}) {
    if (!scene || !Array.isArray(scene.instances) || !Array.isArray(scene.geometries)) {
        throw new Error('buildTlas requires a prepared RayScene.');
    }
    if (!Array.isArray(blases) || blases.length !== scene.geometries.length) {
        throw new Error('buildTlas requires one BLAS entry per scene geometry.');
    }
    const start = now();
    const records = [];
    scene.instances.forEach((instance, instanceIndex) => {
        const geometry = scene.geometries[instance.geometryIndex];
        const blas = blases[instance.geometryIndex];
        if (!geometry || !blas) throw new Error(`Instance ${instanceIndex} references missing geometry or BLAS data.`);
        if (!instance.inverseWorldMatrix || instance.inverseWorldMatrix.length !== 16) {
            throw new Error(`Instance ${instanceIndex} must have a prepared inverse world matrix.`);
        }
        if (blas.nodes.length === 0) return;
        const bounds = computeInstanceBounds(
            geometry.bounds || computeGeometryBounds(geometry.positions),
            instance.worldMatrix,
        );
        records.push({ id: instanceIndex, min: bounds.min, max: bounds.max, centroid: bounds.center });
    });
    const built = buildMedianBvh(records, options);
    if (!built.diagnostics.stackSafe) {
        throw new Error(`TLAS depth ${built.maxDepth} exceeds the 64-entry traversal stack.`);
    }
    return {
        nodes: built.nodes,
        instanceIndices: built.leafReferences,
        maxDepth: built.maxDepth,
        leafCount: built.leafCount,
        buildMs: now() - start,
        diagnostics: built.diagnostics,
    };
}

