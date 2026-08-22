// WebGPU ray tracing MVP: primary rays, TLAS -> BLAS traversal, direct area light,
// hard shadows, running-average accumulation, and fullscreen tone mapping.

const INVALID_INDEX : u32 = 0xffffffffu;
const INSTANCE_FLAG_FLIPS_HANDEDNESS : u32 = 1u;
const FRAME_FLAG_HAS_TLAS : u32 = 1u;
const TRIANGLE_EPSILON : f32 = 1e-8;
const INFINITY_DISTANCE : f32 = 1e30;
const STACK_CAPACITY : u32 = 64u;
const MAX_BOUNCES : u32 = 16u;
const MAX_SAMPLES_PER_FRAME : u32 = 16u;
const PI : f32 = 3.141592653589793;

struct Vertex {
    position : vec4<f32>,
    normal : vec4<f32>,
    texCoord : vec2<f32>,
    padding : vec2<f32>,
}

struct Triangle {
    i0 : u32,
    i1 : u32,
    i2 : u32,
    geometryIndex : u32,
}

struct BvhNode {
    min : vec3<f32>,
    leftFirst : u32,
    max : vec3<f32>,
    primitiveCount : u32,
}

struct Instance {
    worldMatrix : mat4x4<f32>,
    inverseWorldMatrix : mat4x4<f32>,
    blasRoot : u32,
    geometryIndex : u32,
    materialIndex : u32,
    flags : u32,
}

struct Material {
    baseColor : vec4<f32>,
    emissive : vec4<f32>,
    surface : vec4<f32>,
    textureIndex : u32,
    flags : u32,
    reserved0 : u32,
    reserved1 : u32,
}

struct FrameUniforms {
    cameraPosition : vec4<f32>,
    cameraRight : vec4<f32>,
    cameraUp : vec4<f32>,
    cameraForward : vec4<f32>,
    dimensions : vec4<u32>,
    renderSettings : vec4<u32>,
    numerical : vec4<f32>,
    environment : vec4<f32>,
    lightPosition : vec4<f32>,
    lightU : vec4<f32>,
    lightV : vec4<f32>,
    lightColor : vec4<f32>,
}

struct Diagnostics {
    stackOverflowCount : atomic<u32>,
    nonFiniteCount : atomic<u32>,
    rayCount : atomic<u32>,
    reserved : atomic<u32>,
}

struct Ray {
    origin : vec3<f32>,
    direction : vec3<f32>,
}

struct LocalHit {
    valid : u32,
    t : f32,
    triangleIndex : u32,
    padding : u32,
    barycentric : vec3<f32>,
    geometricNormal : vec3<f32>,
    shadingNormal : vec3<f32>,
}

struct WorldHit {
    valid : u32,
    t : f32,
    materialIndex : u32,
    instanceIndex : u32,
    position : vec3<f32>,
    geometricNormal : vec3<f32>,
    shadingNormal : vec3<f32>,
}

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<storage, read> vertices : array<Vertex>;
@group(0) @binding(2) var<storage, read> triangles : array<Triangle>;
@group(0) @binding(3) var<storage, read> bvhNodes : array<BvhNode>;
@group(0) @binding(4) var<storage, read> leafReferences : array<u32>;
@group(0) @binding(5) var<storage, read> instances : array<Instance>;
@group(0) @binding(6) var<storage, read> materials : array<Material>;
@group(0) @binding(7) var<storage, read_write> diagnostics : Diagnostics;

@group(1) @binding(0) var previousAccumulation : texture_2d<f32>;
@group(1) @binding(1) var nextAccumulation : texture_storage_2d<rgba16float, write>;

fn noLocalHit(tMax : f32) -> LocalHit {
    return LocalHit(0u, tMax, INVALID_INDEX, 0u, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
}

fn noWorldHit(tMax : f32) -> WorldHit {
    return WorldHit(0u, tMax, INVALID_INDEX, INVALID_INDEX, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
}

fn rngNext(state : ptr<function, u32>) -> f32 {
    var x = *state;
    if (x == 0u) {
        x = 0x6d2b79f5u;
    }
    x = x ^ (x << 13u);
    x = x ^ (x >> 17u);
    x = x ^ (x << 5u);
    *state = x;
    return f32(x >> 8u) * (1.0 / 16777216.0);
}

fn intersectAabb(ray : Ray, boundsMin : vec3<f32>, boundsMax : vec3<f32>, tMin : f32, tMax : f32) -> f32 {
    var enter = tMin;
    var exit = tMax;
    for (var axis = 0u; axis < 3u; axis += 1u) {
        let origin = ray.origin[axis];
        let direction = ray.direction[axis];
        if (abs(direction) < 1e-20) {
            if (origin < boundsMin[axis] || origin > boundsMax[axis]) {
                return INFINITY_DISTANCE;
            }
        } else {
            let inverseDirection = 1.0 / direction;
            let first = (boundsMin[axis] - origin) * inverseDirection;
            let second = (boundsMax[axis] - origin) * inverseDirection;
            enter = max(enter, min(first, second));
            exit = min(exit, max(first, second));
            if (enter > exit) {
                return INFINITY_DISTANCE;
            }
        }
    }
    if (enter < tMax && exit >= tMin) {
        return enter;
    }
    return INFINITY_DISTANCE;
}

fn intersectTriangle(ray : Ray, triangleIndex : u32, tMin : f32, tMax : f32) -> LocalHit {
    let triangle = triangles[triangleIndex];
    let p0 = vertices[triangle.i0].position.xyz;
    let p1 = vertices[triangle.i1].position.xyz;
    let p2 = vertices[triangle.i2].position.xyz;
    let edge1 = p1 - p0;
    let edge2 = p2 - p0;
    let pVector = cross(ray.direction, edge2);
    let determinant = dot(edge1, pVector);
    if (abs(determinant) < TRIANGLE_EPSILON) {
        return noLocalHit(tMax);
    }
    let inverseDeterminant = 1.0 / determinant;
    let tVector = ray.origin - p0;
    let u = dot(tVector, pVector) * inverseDeterminant;
    if (u < 0.0 || u > 1.0) {
        return noLocalHit(tMax);
    }
    let qVector = cross(tVector, edge1);
    let v = dot(ray.direction, qVector) * inverseDeterminant;
    if (v < 0.0 || u + v > 1.0) {
        return noLocalHit(tMax);
    }
    let distance = dot(edge2, qVector) * inverseDeterminant;
    if (distance < tMin || distance >= tMax) {
        return noLocalHit(tMax);
    }

    let geometricNormal = normalize(cross(edge1, edge2));
    let barycentric = vec3<f32>(1.0 - u - v, u, v);
    var shadingNormal = normalize(
        vertices[triangle.i0].normal.xyz * barycentric.x
        + vertices[triangle.i1].normal.xyz * barycentric.y
        + vertices[triangle.i2].normal.xyz * barycentric.z
    );
    if (dot(shadingNormal, geometricNormal) < 0.0) {
        shadingNormal = -shadingNormal;
    }
    return LocalHit(1u, distance, triangleIndex, 0u, barycentric, geometricNormal, shadingNormal);
}

fn pushChildren(
    stack : ptr<function, array<u32, 64>>,
    stackSize : ptr<function, u32>,
    leftIndex : u32,
    leftDistance : f32,
    rightIndex : u32,
    rightDistance : f32,
) -> bool {
    let hasLeft = leftDistance < INFINITY_DISTANCE;
    let hasRight = rightDistance < INFINITY_DISTANCE;
    let count = u32(hasLeft) + u32(hasRight);
    if (*stackSize + count > STACK_CAPACITY) {
        atomicAdd(&diagnostics.stackOverflowCount, 1u);
        return false;
    }
    if (hasLeft && hasRight) {
        if (leftDistance <= rightDistance) {
            (*stack)[*stackSize] = rightIndex;
            *stackSize += 1u;
            (*stack)[*stackSize] = leftIndex;
            *stackSize += 1u;
        } else {
            (*stack)[*stackSize] = leftIndex;
            *stackSize += 1u;
            (*stack)[*stackSize] = rightIndex;
            *stackSize += 1u;
        }
    } else if (hasLeft) {
        (*stack)[*stackSize] = leftIndex;
        *stackSize += 1u;
    } else if (hasRight) {
        (*stack)[*stackSize] = rightIndex;
        *stackSize += 1u;
    }
    return true;
}

fn intersectBlas(ray : Ray, root : u32, tMin : f32, tMax : f32, anyHit : bool) -> LocalHit {
    if (root == INVALID_INDEX) {
        return noLocalHit(tMax);
    }
    var result = noLocalHit(tMax);
    var closest = tMax;
    var stack : array<u32, 64>;
    var stackSize = 1u;
    stack[0] = root;
    loop {
        if (stackSize == 0u) {
            break;
        }
        stackSize -= 1u;
        let nodeIndex = stack[stackSize];
        let node = bvhNodes[nodeIndex];
        if (intersectAabb(ray, node.min, node.max, tMin, closest) >= INFINITY_DISTANCE) {
            continue;
        }
        if (node.primitiveCount > 0u) {
            let end = node.leftFirst + node.primitiveCount;
            for (var referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1u) {
                let hit = intersectTriangle(ray, leafReferences[referenceIndex], tMin, closest);
                if (hit.valid == 0u) {
                    continue;
                }
                if (anyHit) {
                    return hit;
                }
                result = hit;
                closest = hit.t;
            }
            continue;
        }
        let leftIndex = node.leftFirst;
        let rightIndex = leftIndex + 1u;
        let leftNode = bvhNodes[leftIndex];
        let rightNode = bvhNodes[rightIndex];
        let leftDistance = intersectAabb(ray, leftNode.min, leftNode.max, tMin, closest);
        let rightDistance = intersectAabb(ray, rightNode.min, rightNode.max, tMin, closest);
        if (!pushChildren(&stack, &stackSize, leftIndex, leftDistance, rightIndex, rightDistance)) {
            return result;
        }
    }
    return result;
}

fn transformNormal(inverseWorld : mat4x4<f32>, normal : vec3<f32>) -> vec3<f32> {
    return normalize(vec3<f32>(
        dot(inverseWorld[0].xyz, normal),
        dot(inverseWorld[1].xyz, normal),
        dot(inverseWorld[2].xyz, normal)
    ));
}

fn intersectScene(ray : Ray, tMin : f32, tMax : f32, anyHit : bool) -> WorldHit {
    atomicAdd(&diagnostics.rayCount, 1u);
    if ((frame.renderSettings.w & FRAME_FLAG_HAS_TLAS) == 0u) {
        return noWorldHit(tMax);
    }
    var result = noWorldHit(tMax);
    var closest = tMax;
    var stack : array<u32, 64>;
    var stackSize = 1u;
    stack[0] = 0u;
    loop {
        if (stackSize == 0u) {
            break;
        }
        stackSize -= 1u;
        let nodeIndex = stack[stackSize];
        let node = bvhNodes[nodeIndex];
        if (intersectAabb(ray, node.min, node.max, tMin, closest) >= INFINITY_DISTANCE) {
            continue;
        }
        if (node.primitiveCount > 0u) {
            let end = node.leftFirst + node.primitiveCount;
            for (var referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1u) {
                let instanceIndex = leafReferences[referenceIndex];
                let instance = instances[instanceIndex];
                if (instance.blasRoot == INVALID_INDEX) {
                    continue;
                }
                let localRay = Ray(
                    (instance.inverseWorldMatrix * vec4<f32>(ray.origin, 1.0)).xyz,
                    (instance.inverseWorldMatrix * vec4<f32>(ray.direction, 0.0)).xyz
                );
                let localHit = intersectBlas(localRay, instance.blasRoot, tMin, closest, anyHit);
                if (localHit.valid == 0u) {
                    continue;
                }
                var geometricNormal = transformNormal(instance.inverseWorldMatrix, localHit.geometricNormal);
                var shadingNormal = transformNormal(instance.inverseWorldMatrix, localHit.shadingNormal);
                if ((instance.flags & INSTANCE_FLAG_FLIPS_HANDEDNESS) != 0u) {
                    geometricNormal = -geometricNormal;
                    shadingNormal = -shadingNormal;
                }
                if (dot(shadingNormal, geometricNormal) < 0.0) {
                    shadingNormal = -shadingNormal;
                }
                if (dot(ray.direction, geometricNormal) >= 0.0) {
                    shadingNormal = -shadingNormal;
                }
                result = WorldHit(
                    1u,
                    localHit.t,
                    instance.materialIndex,
                    instanceIndex,
                    ray.origin + ray.direction * localHit.t,
                    geometricNormal,
                    shadingNormal
                );
                closest = localHit.t;
                if (anyHit) {
                    return result;
                }
            }
            continue;
        }
        let leftIndex = node.leftFirst;
        let rightIndex = leftIndex + 1u;
        let leftNode = bvhNodes[leftIndex];
        let rightNode = bvhNodes[rightIndex];
        let leftDistance = intersectAabb(ray, leftNode.min, leftNode.max, tMin, closest);
        let rightDistance = intersectAabb(ray, rightNode.min, rightNode.max, tMin, closest);
        if (!pushChildren(&stack, &stackSize, leftIndex, leftDistance, rightIndex, rightDistance)) {
            return result;
        }
    }
    return result;
}

fn estimateDirect(hit : WorldHit, incomingRay : Ray, material : Material, rng : ptr<function, u32>) -> vec3<f32> {
    if (frame.renderSettings.z != 2u || frame.lightPosition.w <= 0.0) {
        return vec3<f32>(0.0);
    }
    let lightCross = cross(frame.lightU.xyz, frame.lightV.xyz);
    let halfArea = length(lightCross);
    if (halfArea <= 0.0) {
        return vec3<f32>(0.0);
    }
    let lightNormal = lightCross / halfArea;
    let lightSample = frame.lightPosition.xyz
        + (2.0 * rngNext(rng) - 1.0) * frame.lightU.xyz
        + (2.0 * rngNext(rng) - 1.0) * frame.lightV.xyz;
    let toLight = lightSample - hit.position;
    let distanceSquared = dot(toLight, toLight);
    let epsilon = frame.numerical.x;
    if (distanceSquared <= epsilon * epsilon) {
        return vec3<f32>(0.0);
    }
    let distance = sqrt(distanceSquared);
    let direction = toLight / distance;
    let surfaceCosine = dot(hit.shadingNormal, direction);
    let lightCosine = dot(lightNormal, -direction);
    if (surfaceCosine <= 0.0 || lightCosine <= 0.0) {
        return vec3<f32>(0.0);
    }
    var offsetNormal = hit.geometricNormal;
    if (dot(incomingRay.direction, offsetNormal) >= 0.0) {
        offsetNormal = -offsetNormal;
    }
    let shadowRay = Ray(hit.position + offsetNormal * epsilon, direction);
    if (intersectScene(shadowRay, epsilon, distance - epsilon, true).valid != 0u) {
        return vec3<f32>(0.0);
    }
    let area = 4.0 * halfArea;
    let emitted = frame.lightColor.xyz * frame.lightPosition.w;
    return material.baseColor.xyz * emitted * (surfaceCosine * lightCosine * area / (distanceSquared * PI));
}

fn sampleCosineHemisphere(normal : vec3<f32>, rng : ptr<function, u32>) -> vec3<f32> {
    let radialSample = clamp(rngNext(rng), 1e-7, 1.0 - 1e-7);
    let angularSample = rngNext(rng);
    let radius = sqrt(radialSample);
    let angle = 2.0 * PI * angularSample;
    let local = vec3<f32>(radius * cos(angle), radius * sin(angle), sqrt(max(0.0, 1.0 - radialSample)));
    let helper = select(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 1.0, 0.0), abs(normal.z) >= 0.999);
    let tangent = normalize(cross(helper, normal));
    let bitangent = cross(normal, tangent);
    return normalize(tangent * local.x + bitangent * local.y + normal * local.z);
}

fn orientedGeometricNormal(hit : WorldHit, incomingDirection : vec3<f32>) -> vec3<f32> {
    if (dot(incomingDirection, hit.geometricNormal) < 0.0) {
        return hit.geometricNormal;
    }
    return -hit.geometricNormal;
}

fn samplePath(pixel : vec2<u32>, rng : ptr<function, u32>) -> vec3<f32> {
    let dimensions = vec2<f32>(frame.dimensions.xy);
    let jitter = vec2<f32>(rngNext(rng), rngNext(rng));
    let uv = (vec2<f32>(pixel) + jitter) / dimensions;
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let aspect = dimensions.x / dimensions.y;
    let direction = normalize(
        frame.cameraForward.xyz
        + frame.cameraRight.xyz * (ndc.x * aspect * frame.cameraForward.w)
        + frame.cameraUp.xyz * (ndc.y * frame.cameraForward.w)
    );
    var ray = Ray(frame.cameraPosition.xyz, direction);
    var radiance = vec3<f32>(0.0);
    var throughput = vec3<f32>(1.0);
    let bounceLimit = min(frame.renderSettings.x, MAX_BOUNCES);
    for (var bounce = 0u; bounce < bounceLimit; bounce += 1u) {
        let hit = intersectScene(ray, frame.numerical.x, INFINITY_DISTANCE, false);
        if (hit.valid == 0u) {
            radiance += throughput * frame.environment.xyz * frame.numerical.z;
            break;
        }
        let material = materials[hit.materialIndex];
        if (bounce == 0u) {
            radiance += throughput * material.emissive.xyz * material.emissive.w;
        }
        radiance += throughput * estimateDirect(hit, ray, material, rng);
        if (bounce + 1u >= bounceLimit) {
            break;
        }

        let nextDirection = sampleCosineHemisphere(hit.shadingNormal, rng);
        throughput *= material.baseColor.xyz;
        if (any(throughput != throughput)
            || any(abs(throughput) >= vec3<f32>(INFINITY_DISTANCE))
            || max(throughput.x, max(throughput.y, throughput.z)) <= 0.0) {
            break;
        }
        if (bounce >= 2u) {
            let survival = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.95);
            if (rngNext(rng) > survival) {
                break;
            }
            throughput /= survival;
        }
        var offsetNormal = orientedGeometricNormal(hit, ray.direction);
        if (dot(offsetNormal, nextDirection) < 0.0) {
            offsetNormal = -offsetNormal;
        }
        ray = Ray(hit.position + offsetNormal * frame.numerical.x, nextDirection);
    }
    return max(radiance, vec3<f32>(0.0));
}

@compute @workgroup_size(8, 8, 1)
fn cs_raytrace(@builtin(global_invocation_id) invocation : vec3<u32>) {
    let pixel = invocation.xy;
    if (pixel.x >= frame.dimensions.x || pixel.y >= frame.dimensions.y) {
        return;
    }
    let batchSampleCount = min(frame.renderSettings.y, MAX_SAMPLES_PER_FRAME);
    var batchSampleSum = vec3<f32>(0.0);
    for (var sampleOffset = 0u; sampleOffset < batchSampleCount; sampleOffset += 1u) {
        let globalSampleIndex = frame.dimensions.z + sampleOffset;
        // Shared with pixelSampleSeed() in core/random.js. Do not change one
        // implementation without updating the deterministic parity contract.
        var rng = frame.dimensions.w
            ^ (pixel.x * 0x9e3779b9u)
            ^ (pixel.y * 0x85ebca6bu)
            ^ (globalSampleIndex * 0xc2b2ae35u);
        batchSampleSum += samplePath(pixel, &rng);
    }
    let oldSampleCount = frame.dimensions.z;
    let nextSampleCount = oldSampleCount + batchSampleCount;
    var average = batchSampleSum / f32(batchSampleCount);
    if (oldSampleCount > 0u) {
        let previous = textureLoad(previousAccumulation, vec2<i32>(pixel), 0).xyz;
        average = (previous * f32(oldSampleCount) + batchSampleSum) / f32(nextSampleCount);
    }
    if (any(average != average) || any(abs(average) >= vec3<f32>(INFINITY_DISTANCE))) {
        atomicAdd(&diagnostics.nonFiniteCount, 1u);
        average = vec3<f32>(0.0);
    }
    textureStore(nextAccumulation, vec2<i32>(pixel), vec4<f32>(max(average, vec3<f32>(0.0)), 1.0));
}

// === RAYTRACE DISPLAY SHADER ===

struct DisplayUniforms {
    exposure : f32,
    reserved0 : f32,
    reserved1 : f32,
    reserved2 : f32,
}

@group(0) @binding(0) var displayTexture : texture_2d<f32>;
@group(0) @binding(1) var<uniform> display : DisplayUniforms;

@vertex
fn vs_fullscreen(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
    let positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return vec4<f32>(positions[index], 0.0, 1.0);
}

fn linearToSrgb(color : vec3<f32>) -> vec3<f32> {
    let low = color * 12.92;
    let high = 1.055 * pow(color, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(high, low, color <= vec3<f32>(0.0031308));
}

@fragment
fn fs_display(@builtin(position) position : vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(position.xy);
    let linear = max(textureLoad(displayTexture, pixel, 0).xyz * display.exposure, vec3<f32>(0.0));
    let mapped = linear / (vec3<f32>(1.0) + linear);
    return vec4<f32>(linearToSrgb(mapped), 1.0);
}
