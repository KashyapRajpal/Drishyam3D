import { intersectTlas } from '../acceleration/intersections.js';
import { nextFloat } from '../core/random.js';

export const DEFAULT_PATH_TRACING_SETTINGS = Object.freeze({
    maxBounces: 4,
});

const PI = Math.PI;

function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

function scale(vector, scalar) {
    return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

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

function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (!Number.isFinite(length) || length < 1e-12) return null;
    return scale(vector, 1 / length);
}

function maxComponent(vector) {
    return Math.max(vector[0], vector[1], vector[2]);
}

function finiteColor(color) {
    return color.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
}

function orientedGeometricNormal(hit) {
    return hit.frontFace ? hit.geometricNormal : scale(hit.geometricNormal, -1);
}

function rayEpsilon(scene) {
    return 1e-4 * Math.max(1, scene.bounds?.radius || 0);
}

/** Cosine-weighted direction around a normalized world-space normal. */
export function sampleCosineHemisphere(normal, rngState) {
    const r1 = nextFloat(rngState);
    const r2 = nextFloat(rngState);
    const radius = Math.sqrt(Math.max(0, r1));
    const angle = 2 * PI * r2;
    const localX = radius * Math.cos(angle);
    const localY = radius * Math.sin(angle);
    const localZ = Math.sqrt(Math.max(0, 1 - r1));
    const helper = Math.abs(normal[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0];
    const tangent = normalize(cross(helper, normal));
    const bitangent = cross(normal, tangent);
    return normalize([
        tangent[0] * localX + bitangent[0] * localY + normal[0] * localZ,
        tangent[1] * localX + bitangent[1] * localY + normal[1] * localZ,
        tangent[2] * localX + bitangent[2] * localY + normal[2] * localZ,
    ]);
}

export function sampleRectLight(light, rngState) {
    const uSample = nextFloat(rngState) * 2 - 1;
    const vSample = nextFloat(rngState) * 2 - 1;
    const crossUv = cross(light.u, light.v);
    const halfParallelogramArea = Math.hypot(...crossUv);
    if (!(halfParallelogramArea > 0)) return null;
    return {
        position: add(light.center, add(scale(light.u, uSample), scale(light.v, vSample))),
        normal: scale(crossUv, 1 / halfParallelogramArea),
        area: 4 * halfParallelogramArea,
    };
}

/** One-sample next-event estimate for diffuse rectangular lights. */
export function estimateDirectLighting(hit, material, scene, acceleration, rngState, epsilon) {
    const lights = (scene.lights || []).filter((light) => light.type === 'rect');
    if (lights.length === 0) return [0, 0, 0];
    const lightIndex = Math.min(lights.length - 1, Math.floor(nextFloat(rngState) * lights.length));
    const light = lights[lightIndex];
    const sample = sampleRectLight(light, rngState);
    if (!sample) return [0, 0, 0];
    const toLight = subtract(sample.position, hit.position);
    const distanceSquared = dot(toLight, toLight);
    if (!(distanceSquared > epsilon * epsilon)) return [0, 0, 0];
    const distance = Math.sqrt(distanceSquared);
    const direction = scale(toLight, 1 / distance);
    const surfaceCosine = dot(hit.shadingNormal, direction);
    const lightCosine = dot(sample.normal, scale(direction, -1));
    if (surfaceCosine <= 0 || lightCosine <= 0) return [0, 0, 0];

    const originNormal = orientedGeometricNormal(hit);
    const shadowRay = {
        origin: add(hit.position, scale(originNormal, epsilon)),
        direction,
    };
    if (intersectTlas(shadowRay, scene, acceleration, epsilon, distance - epsilon, true)) {
        return [0, 0, 0];
    }
    const emitted = scale(light.color || [1, 1, 1], light.intensity ?? 1);
    const geometryOverPdf = surfaceCosine * lightCosine * sample.area / distanceSquared;
    return scale(multiply(material.baseColor.slice(0, 3), emitted), (
        geometryOverPdf * lights.length / PI
    ));
}

/** Pure single-path sample. All stochastic state is supplied by the caller. */
export function traceSample(initialRay, scene, acceleration, rngState, settings = {}) {
    const maxBounces = settings.maxBounces ?? DEFAULT_PATH_TRACING_SETTINGS.maxBounces;
    if (!Number.isInteger(maxBounces) || maxBounces < 1) {
        throw new Error('maxBounces must be a positive integer.');
    }
    const epsilon = settings.rayEpsilon ?? rayEpsilon(scene);
    let ray = { origin: [...initialRay.origin], direction: [...initialRay.direction] };
    let radiance = [0, 0, 0];
    let throughput = [1, 1, 1];

    for (let bounce = 0; bounce < maxBounces; bounce += 1) {
        if (settings.shouldCancel?.()) break;
        const hit = intersectTlas(ray, scene, acceleration, epsilon, Infinity);
        if (!hit) {
            radiance = add(radiance, multiply(throughput, scene.environment?.color || [0, 0, 0]));
            break;
        }
        const material = scene.materials[hit.materialIndex] || {};
        if (bounce === 0 && (material.emissiveStrength || 0) > 0) {
            radiance = add(radiance, multiply(
                throughput,
                scale(material.emissive || [0, 0, 0], material.emissiveStrength),
            ));
        }

        const direct = estimateDirectLighting(hit, material, scene, acceleration, rngState, epsilon);
        radiance = add(radiance, multiply(throughput, direct));

        const nextDirection = sampleCosineHemisphere(hit.shadingNormal, rngState);
        if (!nextDirection) break;
        throughput = multiply(throughput, (material.baseColor || [1, 1, 1]).slice(0, 3));
        if (!throughput.every(Number.isFinite) || maxComponent(throughput) <= 0) break;

        if (bounce >= 2) {
            const survival = Math.min(0.95, Math.max(0.05, maxComponent(throughput)));
            if (nextFloat(rngState) > survival) break;
            throughput = scale(throughput, 1 / survival);
        }
        const normal = orientedGeometricNormal(hit);
        ray = {
            origin: add(hit.position, scale(dot(normal, nextDirection) >= 0 ? normal : scale(normal, -1), epsilon)),
            direction: nextDirection,
        };
    }
    return finiteColor(radiance);
}

export function reinhardToneMap(value) {
    const safe = Math.max(0, Number.isFinite(value) ? value : 0);
    return safe / (1 + safe);
}

export function linearToSrgb(value) {
    const safe = Math.max(0, Number.isFinite(value) ? value : 0);
    return safe <= 0.0031308 ? 12.92 * safe : 1.055 * (safe ** (1 / 2.4)) - 0.055;
}

export function srgbToLinear(value) {
    const safe = Math.max(0, Number.isFinite(value) ? value : 0);
    return safe <= 0.04045 ? safe / 12.92 : ((safe + 0.055) / 1.055) ** 2.4;
}

export function linearRgbToRgba8(color, target, offset = 0) {
    for (let channel = 0; channel < 3; channel += 1) {
        const encoded = linearToSrgb(reinhardToneMap(color[channel]));
        target[offset + channel] = Math.round(Math.min(1, encoded) * 255);
    }
    target[offset + 3] = 255;
    return target;
}
