import { buildBlas } from './blas-builder.js';
import { buildTlas } from './tlas-builder.js';

const REVISION_FIELDS = ['geometryRevision', 'instanceRevision'];

function normalizeRevisions(revisions = {}, fallback = {}) {
    const normalized = {};
    for (const field of REVISION_FIELDS) {
        const value = revisions[field] ?? fallback[field] ?? 0;
        if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
        normalized[field] = value;
    }
    return normalized;
}

function blasKey(geometry, geometryIndex) {
    return `${geometry.id}:${geometry.revision}:${geometryIndex}`;
}

function buildBlases(scene, previous, options) {
    const cache = new Map();
    for (const blas of previous?.blases || []) {
        cache.set(`${blas.geometryId}:${blas.geometryRevision}:${blas.geometryIndex}`, blas);
    }
    let buildMs = 0;
    const blases = scene.geometries.map((geometry, geometryIndex) => {
        const cached = cache.get(blasKey(geometry, geometryIndex));
        if (cached) return cached;
        const blas = buildBlas(geometry, geometryIndex, options);
        buildMs += blas.buildMs;
        return blas;
    });
    return { blases, buildMs };
}

export function buildAccelerationStructures(scene, options = {}) {
    const revisions = normalizeRevisions(options.revisions);
    const { blases, buildMs } = buildBlases(scene, null, options);
    const tlas = buildTlas(scene, blases, options);
    return {
        blases,
        tlas,
        blasBuildMs: buildMs,
        tlasBuildMs: tlas.buildMs,
        revisions,
        scene,
    };
}

/** Reuses unchanged per-geometry BLASes and rebuilds only the TLAS for transform edits. */
export function updateAccelerationStructures(previous, scene, revisions = {}, options = {}) {
    if (!previous) return buildAccelerationStructures(scene, { ...options, revisions });
    const nextRevisions = normalizeRevisions(revisions, previous.revisions);
    const { blases, buildMs } = buildBlases(scene, previous, options);
    const blasChanged = blases.length !== previous.blases.length
        || blases.some((blas, index) => blas !== previous.blases[index]);
    const instancesChanged = nextRevisions.instanceRevision !== previous.revisions.instanceRevision;
    const geometryRevisionChanged = nextRevisions.geometryRevision !== previous.revisions.geometryRevision;

    if (!blasChanged && !instancesChanged && !geometryRevisionChanged) {
        return { ...previous, revisions: nextRevisions, scene };
    }
    const tlas = buildTlas(scene, blases, options);
    return {
        blases,
        tlas,
        blasBuildMs: buildMs,
        tlasBuildMs: tlas.buildMs,
        revisions: nextRevisions,
        scene,
    };
}
