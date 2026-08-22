import { createIdentityMatrix, invertMatrix, transformPoint } from '../../matrix.js';

/**
 * @typedef {Object} Bounds
 * @property {number[]} min
 * @property {number[]} max
 * @property {number[]} center
 * @property {number} radius
 */

/**
 * @typedef {Object} RayGeometry
 * @property {number} id Stable source identifier.
 * @property {number} revision Monotonic local-geometry revision.
 * @property {ArrayLike<number>} positions Tightly packed local-space xyz values.
 * @property {ArrayLike<number>} normals Tightly packed local-space xyz values.
 * @property {ArrayLike<number>} [texCoords] Tightly packed uv values.
 * @property {ArrayLike<number>} indices Triangle vertex indices.
 */

/**
 * @typedef {Object} RayInstance
 * @property {number} id Stable source identifier.
 * @property {number} geometryIndex
 * @property {number} materialIndex
 * @property {ArrayLike<number>} worldMatrix Column-major local-to-world matrix.
 */

/**
 * @typedef {Object} RayScene
 * @property {RayGeometry[]} geometries
 * @property {RayInstance[]} instances
 * @property {Object[]} materials
 * @property {Object[]} [lights]
 * @property {Object|null} [camera]
 * @property {{color: number[]}} [environment]
 */

/**
 * Prepared scenes own Float32/Uint32 copies of source arrays. Instances additionally
 * contain inverseWorldMatrix and geometries contain local Bounds.
 * @typedef {RayScene & {bounds: Bounds}} PreparedRayScene
 */

export function emptyBounds() {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0 };
}

function boundsFromMinMax(min, max) {
    if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return emptyBounds();
    const center = [
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5,
    ];
    return {
        min: [...min],
        max: [...max],
        center,
        radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.5,
    };
}

export function computeGeometryBounds(positions) {
    if (!positions || positions.length === 0) return emptyBounds();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
            const value = positions[i + axis];
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
        }
    }
    return boundsFromMinMax(min, max);
}

/** Conservative world AABB obtained by transforming all eight local AABB corners. */
export function computeInstanceBounds(geometryBounds, worldMatrix) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const bmin = geometryBounds.min;
    const bmax = geometryBounds.max;
    for (let mask = 0; mask < 8; mask += 1) {
        const point = transformPoint(worldMatrix, [
            (mask & 1) ? bmax[0] : bmin[0],
            (mask & 2) ? bmax[1] : bmin[1],
            (mask & 4) ? bmax[2] : bmin[2],
        ]);
        for (let axis = 0; axis < 3; axis += 1) {
            if (point[axis] < min[axis]) min[axis] = point[axis];
            if (point[axis] > max[axis]) max[axis] = point[axis];
        }
    }
    return boundsFromMinMax(min, max);
}

export function computeSceneBounds(scene) {
    if (!scene?.instances?.length) return emptyBounds();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let found = false;
    for (const instance of scene.instances) {
        const geometry = scene.geometries[instance.geometryIndex];
        if (!geometry) continue;
        const bounds = computeInstanceBounds(
            geometry.bounds || computeGeometryBounds(geometry.positions),
            instance.worldMatrix,
        );
        found = true;
        for (let axis = 0; axis < 3; axis += 1) {
            if (bounds.min[axis] < min[axis]) min[axis] = bounds.min[axis];
            if (bounds.max[axis] > max[axis]) max[axis] = bounds.max[axis];
        }
    }
    return found ? boundsFromMinMax(min, max) : emptyBounds();
}

/** @returns {RayScene} */
export function createEmptyRayScene() {
    return {
        geometries: [],
        instances: [],
        materials: [],
        lights: [],
        camera: null,
        environment: { color: [0, 0, 0] },
    };
}

function validateFiniteArray(errors, value, expectedMultiple, label, { allowEmpty = false } = {}) {
    if (!value || typeof value.length !== 'number') {
        errors.push(`${label} is required.`);
        return;
    }
    if (!allowEmpty && value.length === 0) errors.push(`${label} must not be empty.`);
    if (value.length % expectedMultiple !== 0) {
        errors.push(`${label} length must be a multiple of ${expectedMultiple}.`);
    }
    for (let i = 0; i < value.length; i += 1) {
        if (!Number.isFinite(value[i])) {
            errors.push(`${label}[${i}] must be finite.`);
            break;
        }
    }
}

/** @param {RayScene} scene */
export function validateRayScene(scene) {
    const errors = [];
    if (!scene || typeof scene !== 'object') return { ok: false, errors: ['Scene must be an object.'] };
    const geometries = Array.isArray(scene.geometries) ? scene.geometries : [];
    const instances = Array.isArray(scene.instances) ? scene.instances : [];
    const materials = Array.isArray(scene.materials) ? scene.materials : [];
    if (!Array.isArray(scene.geometries)) errors.push('Scene.geometries must be an array.');
    if (!Array.isArray(scene.instances)) errors.push('Scene.instances must be an array.');
    if (!Array.isArray(scene.materials)) errors.push('Scene.materials must be an array.');

    const geometryIds = new Set();
    geometries.forEach((geometry, geometryIndex) => {
        const label = `Geometry ${geometryIndex}`;
        if (!Number.isInteger(geometry?.id) || geometry.id < 0) errors.push(`${label}.id must be a non-negative integer.`);
        else if (geometryIds.has(geometry.id)) errors.push(`${label}.id ${geometry.id} is duplicated.`);
        else geometryIds.add(geometry.id);
        if (!Number.isInteger(geometry?.revision) || geometry.revision < 0) {
            errors.push(`${label}.revision must be a non-negative integer.`);
        }
        validateFiniteArray(errors, geometry?.positions, 3, `${label}.positions`);
        validateFiniteArray(errors, geometry?.normals, 3, `${label}.normals`);
        if (geometry?.positions?.length !== geometry?.normals?.length) {
            errors.push(`${label}.normals length must match positions length.`);
        }
        if (geometry?.texCoords != null) {
            validateFiniteArray(errors, geometry.texCoords, 2, `${label}.texCoords`, { allowEmpty: true });
            if (geometry.positions && geometry.texCoords.length !== (geometry.positions.length / 3) * 2) {
                errors.push(`${label}.texCoords length must be two values per vertex.`);
            }
        }
        if (!geometry?.indices || typeof geometry.indices.length !== 'number') {
            errors.push(`${label}.indices is required.`);
        } else {
            if (geometry.indices.length % 3 !== 0) errors.push(`${label}.indices length must be a multiple of 3.`);
            const vertexCount = (geometry.positions?.length || 0) / 3;
            for (let i = 0; i < geometry.indices.length; i += 1) {
                const index = geometry.indices[i];
                if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
                    errors.push(`${label}.indices[${i}] is out of range.`);
                    break;
                }
            }
        }
    });

    const instanceIds = new Set();
    instances.forEach((instance, instanceIndex) => {
        const label = `Instance ${instanceIndex}`;
        if (!Number.isInteger(instance?.id) || instance.id < 0) errors.push(`${label}.id must be a non-negative integer.`);
        else if (instanceIds.has(instance.id)) errors.push(`${label}.id ${instance.id} is duplicated.`);
        else instanceIds.add(instance.id);
        if (!Number.isInteger(instance?.geometryIndex) || !geometries[instance.geometryIndex]) {
            errors.push(`${label}.geometryIndex is out of range.`);
        }
        if (!Number.isInteger(instance?.materialIndex) || !materials[instance.materialIndex]) {
            errors.push(`${label}.materialIndex is out of range.`);
        }
        validateFiniteArray(errors, instance?.worldMatrix, 16, `${label}.worldMatrix`);
        if (instance?.worldMatrix?.length !== 16) errors.push(`${label}.worldMatrix must contain exactly 16 values.`);
        if (instance?.worldMatrix?.length === 16) {
            try { invertMatrix(instance.worldMatrix); } catch (_error) { errors.push(`${label}.worldMatrix must be invertible.`); }
        }
    });
    return { ok: errors.length === 0, errors };
}

function normalizeMaterial(material = {}) {
    return {
        baseColor: [...(material.baseColor || [1, 1, 1, 1])],
        emissive: [...(material.emissive || [0, 0, 0])],
        emissiveStrength: Number.isFinite(material.emissiveStrength) ? material.emissiveStrength : 0,
        metallic: Number.isFinite(material.metallic) ? material.metallic : 0,
        roughness: Number.isFinite(material.roughness) ? material.roughness : 1,
        baseColorImageIndex: Number.isInteger(material.baseColorImageIndex) ? material.baseColorImageIndex : -1,
    };
}

/** @param {RayScene} scene @returns {PreparedRayScene} */
export function prepareRayScene(scene) {
    const validation = validateRayScene(scene);
    if (!validation.ok) throw new Error(`Invalid RayScene:\n${validation.errors.join('\n')}`);
    const geometries = scene.geometries.map((geometry) => {
        const positions = new Float32Array(geometry.positions);
        const vertexCount = positions.length / 3;
        return {
            id: geometry.id,
            revision: geometry.revision,
            positions,
            normals: new Float32Array(geometry.normals),
            texCoords: geometry.texCoords
                ? new Float32Array(geometry.texCoords)
                : new Float32Array(vertexCount * 2),
            indices: new Uint32Array(geometry.indices),
            bounds: computeGeometryBounds(positions),
        };
    });
    const instances = scene.instances.map((instance) => {
        const worldMatrix = new Float32Array(instance.worldMatrix || createIdentityMatrix());
        return {
            id: instance.id,
            geometryIndex: instance.geometryIndex,
            materialIndex: instance.materialIndex,
            worldMatrix,
            inverseWorldMatrix: invertMatrix(worldMatrix),
        };
    });
    const prepared = {
        geometries,
        instances,
        materials: scene.materials.map(normalizeMaterial),
        lights: (scene.lights || []).map((light) => ({ ...light })),
        camera: scene.camera ? { ...scene.camera } : null,
        environment: { color: [...(scene.environment?.color || [0, 0, 0])] },
    };
    prepared.bounds = computeSceneBounds(prepared);
    return prepared;
}
