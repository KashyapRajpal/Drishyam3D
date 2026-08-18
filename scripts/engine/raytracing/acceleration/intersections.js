import { determinant3x3, transformDirection, transformPoint } from '../../matrix.js';

export const TRIANGLE_EPSILON = 1e-8;
export const TRAVERSAL_STACK_SIZE = 64;

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector, scalar) {
    return vector.map((component) => {
        const value = component * scalar;
        return Object.is(value, -0) ? 0 : value;
    });
}

function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (!Number.isFinite(length) || length <= TRIANGLE_EPSILON) return null;
    return scale(vector, 1 / length);
}

function readVec3(values, index) {
    const offset = index * 3;
    return [values[offset], values[offset + 1], values[offset + 2]];
}

function transformNormal(inverseWorldMatrix, normal) {
    // transpose(inverseWorldMatrix) * normal, expressed for column-major matrices.
    return normalize([
        inverseWorldMatrix[0] * normal[0] + inverseWorldMatrix[1] * normal[1] + inverseWorldMatrix[2] * normal[2],
        inverseWorldMatrix[4] * normal[0] + inverseWorldMatrix[5] * normal[1] + inverseWorldMatrix[6] * normal[2],
        inverseWorldMatrix[8] * normal[0] + inverseWorldMatrix[9] * normal[1] + inverseWorldMatrix[10] * normal[2],
    ]);
}

/** Returns the first AABB entry distance in [tMin, tMax), or null on a miss. */
export function intersectAabb(ray, min, max, tMin, tMax) {
    let enter = tMin;
    let exit = tMax;
    for (let axis = 0; axis < 3; axis += 1) {
        const origin = ray.origin[axis];
        const direction = ray.direction[axis];
        if (direction === 0) {
            if (origin < min[axis] || origin > max[axis]) return null;
            continue;
        }
        const inverseDirection = 1 / direction;
        let near = (min[axis] - origin) * inverseDirection;
        let far = (max[axis] - origin) * inverseDirection;
        if (near > far) [near, far] = [far, near];
        enter = Math.max(enter, near);
        exit = Math.min(exit, far);
        if (enter > exit) return null;
    }
    return enter < tMax && exit >= tMin ? enter : null;
}

/** Two-sided Moller-Trumbore intersection using an inclusive tMin and exclusive tMax. */
export function intersectTriangle(ray, geometry, triangleIndex, tMin, tMax) {
    const indexOffset = triangleIndex * 3;
    if (indexOffset < 0 || indexOffset + 2 >= geometry.indices.length) return null;
    const i0 = geometry.indices[indexOffset];
    const i1 = geometry.indices[indexOffset + 1];
    const i2 = geometry.indices[indexOffset + 2];
    const p0 = readVec3(geometry.positions, i0);
    const p1 = readVec3(geometry.positions, i1);
    const p2 = readVec3(geometry.positions, i2);
    const edge1 = subtract(p1, p0);
    const edge2 = subtract(p2, p0);
    const pVector = cross(ray.direction, edge2);
    const determinant = dot(edge1, pVector);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < TRIANGLE_EPSILON) return null;

    const inverseDeterminant = 1 / determinant;
    const tVector = subtract(ray.origin, p0);
    const u = dot(tVector, pVector) * inverseDeterminant;
    if (u < 0 || u > 1) return null;
    const qVector = cross(tVector, edge1);
    const v = dot(ray.direction, qVector) * inverseDeterminant;
    if (v < 0 || u + v > 1) return null;
    const t = dot(edge2, qVector) * inverseDeterminant;
    if (!Number.isFinite(t) || t < tMin || t >= tMax) return null;

    const geometricNormal = normalize(cross(edge1, edge2));
    if (!geometricNormal) return null;
    const barycentric = [1 - u - v, u, v];
    let windingShadingNormal = geometricNormal;
    if (geometry.normals?.length === geometry.positions.length) {
        const n0 = readVec3(geometry.normals, i0);
        const n1 = readVec3(geometry.normals, i1);
        const n2 = readVec3(geometry.normals, i2);
        const interpolated = normalize([
            n0[0] * barycentric[0] + n1[0] * barycentric[1] + n2[0] * barycentric[2],
            n0[1] * barycentric[0] + n1[1] * barycentric[1] + n2[1] * barycentric[2],
            n0[2] * barycentric[0] + n1[2] * barycentric[1] + n2[2] * barycentric[2],
        ]);
        if (interpolated) windingShadingNormal = dot(interpolated, geometricNormal) < 0
            ? scale(interpolated, -1)
            : interpolated;
    }
    const frontFace = dot(ray.direction, geometricNormal) < 0;
    return {
        t,
        triangleIndex,
        barycentric,
        geometricNormal,
        shadingNormal: frontFace ? windingShadingNormal : scale(windingShadingNormal, -1),
        frontFace,
    };
}

export function intersectGeometryBruteForce(ray, geometry, tMin, tMax, anyHit = false) {
    let closest = null;
    let closestT = tMax;
    const triangleCount = geometry.indices.length / 3;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        const hit = intersectTriangle(ray, geometry, triangleIndex, tMin, closestT);
        if (!hit) continue;
        if (anyHit) return hit;
        closest = hit;
        closestT = hit.t;
    }
    return closest;
}

/** Closest-hit or any-hit traversal of one local-space BLAS. */
export function intersectBlas(rayLocal, geometry, blas, tMin, tMax, anyHit = false) {
    if (!blas?.nodes?.length) return null;
    const stack = [0];
    let closest = null;
    let closestT = tMax;
    while (stack.length > 0) {
        const nodeIndex = stack.pop();
        const node = blas.nodes[nodeIndex];
        if (!node || intersectAabb(rayLocal, node.min, node.max, tMin, closestT) == null) continue;
        if (node.primitiveCount > 0) {
            const end = node.leftFirst + node.primitiveCount;
            for (let referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1) {
                const triangleIndex = blas.triangleIndices[referenceIndex];
                const hit = intersectTriangle(rayLocal, geometry, triangleIndex, tMin, closestT);
                if (!hit) continue;
                if (anyHit) return hit;
                closest = hit;
                closestT = hit.t;
            }
            continue;
        }
        const leftIndex = node.leftFirst;
        const rightIndex = leftIndex + 1;
        const leftDistance = intersectAabb(rayLocal, blas.nodes[leftIndex].min, blas.nodes[leftIndex].max, tMin, closestT);
        const rightDistance = intersectAabb(rayLocal, blas.nodes[rightIndex].min, blas.nodes[rightIndex].max, tMin, closestT);
        const pending = [];
        if (leftDistance != null) pending.push([leftIndex, leftDistance]);
        if (rightDistance != null) pending.push([rightIndex, rightDistance]);
        // Push far first so the nearest node is popped first.
        pending.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
        if (stack.length + pending.length > TRAVERSAL_STACK_SIZE) {
            throw new Error('BLAS traversal exceeded its 64-entry stack.');
        }
        for (const [childIndex] of pending) stack.push(childIndex);
    }
    return closest;
}

function localRayForInstance(ray, instance) {
    return {
        origin: transformPoint(instance.inverseWorldMatrix, ray.origin),
        // Deliberately not normalized: affine ray t remains the world-space t.
        direction: transformDirection(instance.inverseWorldMatrix, ray.direction),
    };
}

function toWorldHit(ray, localHit, instance, instanceIndex, geometryIndex) {
    const localWindingShadingNormal = localHit.frontFace
        ? localHit.shadingNormal
        : scale(localHit.shadingNormal, -1);
    let geometricNormal = transformNormal(instance.inverseWorldMatrix, localHit.geometricNormal);
    let windingShadingNormal = transformNormal(instance.inverseWorldMatrix, localWindingShadingNormal);
    if (!geometricNormal || !windingShadingNormal) return null;
    if (determinant3x3(instance.worldMatrix) < 0) {
        geometricNormal = scale(geometricNormal, -1);
        windingShadingNormal = scale(windingShadingNormal, -1);
    }
    if (dot(windingShadingNormal, geometricNormal) < 0) {
        windingShadingNormal = scale(windingShadingNormal, -1);
    }
    const frontFace = dot(ray.direction, geometricNormal) < 0;
    return {
        t: localHit.t,
        triangleIndex: localHit.triangleIndex,
        instanceIndex,
        geometryIndex,
        materialIndex: instance.materialIndex,
        barycentric: localHit.barycentric,
        position: [
            ray.origin[0] + ray.direction[0] * localHit.t,
            ray.origin[1] + ray.direction[1] * localHit.t,
            ray.origin[2] + ray.direction[2] * localHit.t,
        ],
        geometricNormal,
        shadingNormal: frontFace ? windingShadingNormal : scale(windingShadingNormal, -1),
        frontFace,
    };
}

/** Reference two-level scene traversal without acceleration structures. */
export function intersectSceneBruteForce(ray, scene, tMin, tMax, anyHit = false) {
    let closest = null;
    let closestT = tMax;
    for (let instanceIndex = 0; instanceIndex < scene.instances.length; instanceIndex += 1) {
        const instance = scene.instances[instanceIndex];
        const geometry = scene.geometries[instance.geometryIndex];
        if (!geometry) continue;
        const localHit = intersectGeometryBruteForce(
            localRayForInstance(ray, instance),
            geometry,
            tMin,
            closestT,
            anyHit,
        );
        if (!localHit) continue;
        const worldHit = toWorldHit(ray, localHit, instance, instanceIndex, instance.geometryIndex);
        if (!worldHit) continue;
        if (anyHit) return worldHit;
        closest = worldHit;
        closestT = worldHit.t;
    }
    return closest;
}

/** Closest-hit or any-hit traversal from world-space TLAS into local-space BLASes. */
export function intersectTlas(rayWorld, scene, acceleration, tMin, tMax, anyHit = false) {
    const tlas = acceleration?.tlas;
    if (!tlas?.nodes?.length) return null;
    const stack = [0];
    let closest = null;
    let closestT = tMax;
    while (stack.length > 0) {
        const nodeIndex = stack.pop();
        const node = tlas.nodes[nodeIndex];
        if (!node || intersectAabb(rayWorld, node.min, node.max, tMin, closestT) == null) continue;
        if (node.primitiveCount > 0) {
            const end = node.leftFirst + node.primitiveCount;
            for (let referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1) {
                const instanceIndex = tlas.instanceIndices[referenceIndex];
                const instance = scene.instances[instanceIndex];
                if (!instance) continue;
                const geometryIndex = instance.geometryIndex;
                const geometry = scene.geometries[geometryIndex];
                const blas = acceleration.blases[geometryIndex];
                const localHit = intersectBlas(
                    localRayForInstance(rayWorld, instance),
                    geometry,
                    blas,
                    tMin,
                    closestT,
                    anyHit,
                );
                if (!localHit) continue;
                const worldHit = toWorldHit(rayWorld, localHit, instance, instanceIndex, geometryIndex);
                if (!worldHit) continue;
                if (anyHit) return worldHit;
                closest = worldHit;
                closestT = worldHit.t;
            }
            continue;
        }
        const leftIndex = node.leftFirst;
        const rightIndex = leftIndex + 1;
        const leftDistance = intersectAabb(rayWorld, tlas.nodes[leftIndex].min, tlas.nodes[leftIndex].max, tMin, closestT);
        const rightDistance = intersectAabb(rayWorld, tlas.nodes[rightIndex].min, tlas.nodes[rightIndex].max, tMin, closestT);
        const pending = [];
        if (leftDistance != null) pending.push([leftIndex, leftDistance]);
        if (rightDistance != null) pending.push([rightIndex, rightDistance]);
        pending.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
        if (stack.length + pending.length > TRAVERSAL_STACK_SIZE) {
            throw new Error('TLAS traversal exceeded its 64-entry stack.');
        }
        for (const [childIndex] of pending) stack.push(childIndex);
    }
    return closest;
}
