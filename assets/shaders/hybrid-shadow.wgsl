const INVALID_INDEX : u32 = 0xffffffffu;
const FRAME_FLAG_HAS_TLAS : u32 = 1u;
const TRIANGLE_EPSILON : f32 = 1e-8;
const INFINITY_DISTANCE : f32 = 1e30;
const STACK_CAPACITY : u32 = 64u;

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

struct ShadowUniforms {
    lightVectorAndType : vec4<f32>,
    numerical : vec4<f32>,
    dimensionsAndFlags : vec4<u32>,
}

struct Ray {
    origin : vec3<f32>,
    direction : vec3<f32>,
}

@group(0) @binding(0) var<uniform> frame : ShadowUniforms;
@group(0) @binding(1) var<storage, read> vertices : array<Vertex>;
@group(0) @binding(2) var<storage, read> triangles : array<Triangle>;
@group(0) @binding(3) var<storage, read> bvhNodes : array<BvhNode>;
@group(0) @binding(4) var<storage, read> leafReferences : array<u32>;
@group(0) @binding(5) var<storage, read> instances : array<Instance>;
@group(0) @binding(6) var<storage, read> materials : array<Material>;

@group(1) @binding(0) var worldPositionTexture : texture_2d<f32>;
@group(1) @binding(1) var normalTexture : texture_2d<f32>;
@group(1) @binding(2) var visibilityTexture : texture_storage_2d<rgba8unorm, write>;

fn intersectAabb(ray : Ray, boundsMin : vec3<f32>, boundsMax : vec3<f32>, tMin : f32, tMax : f32) -> bool {
    var enter = tMin;
    var exit = tMax;
    for (var axis = 0u; axis < 3u; axis += 1u) {
        let origin = ray.origin[axis];
        let direction = ray.direction[axis];
        if (abs(direction) < 1e-20) {
            if (origin < boundsMin[axis] || origin > boundsMax[axis]) {
                return false;
            }
        } else {
            let inverseDirection = 1.0 / direction;
            let first = (boundsMin[axis] - origin) * inverseDirection;
            let second = (boundsMax[axis] - origin) * inverseDirection;
            enter = max(enter, min(first, second));
            exit = min(exit, max(first, second));
            if (enter > exit) {
                return false;
            }
        }
    }
    return enter < tMax && exit >= tMin;
}

// Absolute determinant rejection makes shadow traversal deliberately two-sided.
fn intersectTriangleAny(ray : Ray, triangleIndex : u32, tMin : f32, tMax : f32) -> bool {
    let triangle = triangles[triangleIndex];
    let p0 = vertices[triangle.i0].position.xyz;
    let p1 = vertices[triangle.i1].position.xyz;
    let p2 = vertices[triangle.i2].position.xyz;
    let edge1 = p1 - p0;
    let edge2 = p2 - p0;
    let pVector = cross(ray.direction, edge2);
    let determinant = dot(edge1, pVector);
    if (abs(determinant) < TRIANGLE_EPSILON) {
        return false;
    }
    let inverseDeterminant = 1.0 / determinant;
    let tVector = ray.origin - p0;
    let u = dot(tVector, pVector) * inverseDeterminant;
    if (u < 0.0 || u > 1.0) {
        return false;
    }
    let qVector = cross(tVector, edge1);
    let v = dot(ray.direction, qVector) * inverseDeterminant;
    if (v < 0.0 || u + v > 1.0) {
        return false;
    }
    let distance = dot(edge2, qVector) * inverseDeterminant;
    return distance >= tMin && distance < tMax;
}

fn intersectBlasAny(ray : Ray, root : u32, tMin : f32, tMax : f32) -> bool {
    if (root == INVALID_INDEX) {
        return false;
    }
    var stack : array<u32, 64>;
    var stackSize = 1u;
    stack[0] = root;
    loop {
        if (stackSize == 0u) {
            return false;
        }
        stackSize -= 1u;
        let node = bvhNodes[stack[stackSize]];
        if (!intersectAabb(ray, node.min, node.max, tMin, tMax)) {
            continue;
        }
        if (node.primitiveCount > 0u) {
            let end = node.leftFirst + node.primitiveCount;
            for (var referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1u) {
                if (intersectTriangleAny(ray, leafReferences[referenceIndex], tMin, tMax)) {
                    return true;
                }
            }
        } else {
            if (stackSize + 2u > STACK_CAPACITY) {
                return true;
            }
            stack[stackSize] = node.leftFirst;
            stack[stackSize + 1u] = node.leftFirst + 1u;
            stackSize += 2u;
        }
    }
}

fn sceneOccluded(ray : Ray, tMin : f32, tMax : f32) -> bool {
    if ((frame.dimensionsAndFlags.z & FRAME_FLAG_HAS_TLAS) == 0u) {
        return false;
    }
    var stack : array<u32, 64>;
    var stackSize = 1u;
    stack[0] = 0u;
    loop {
        if (stackSize == 0u) {
            return false;
        }
        stackSize -= 1u;
        let node = bvhNodes[stack[stackSize]];
        if (!intersectAabb(ray, node.min, node.max, tMin, tMax)) {
            continue;
        }
        if (node.primitiveCount > 0u) {
            let end = node.leftFirst + node.primitiveCount;
            for (var referenceIndex = node.leftFirst; referenceIndex < end; referenceIndex += 1u) {
                let instance = instances[leafReferences[referenceIndex]];
                if (instance.blasRoot == INVALID_INDEX) {
                    continue;
                }
                let localRay = Ray(
                    (instance.inverseWorldMatrix * vec4<f32>(ray.origin, 1.0)).xyz,
                    (instance.inverseWorldMatrix * vec4<f32>(ray.direction, 0.0)).xyz
                );
                if (intersectBlasAny(localRay, instance.blasRoot, tMin, tMax)) {
                    return true;
                }
            }
        } else {
            if (stackSize + 2u > STACK_CAPACITY) {
                return true;
            }
            stack[stackSize] = node.leftFirst;
            stack[stackSize + 1u] = node.leftFirst + 1u;
            stackSize += 2u;
        }
    }
}

@compute @workgroup_size(8, 8)
fn cs_shadow(@builtin(global_invocation_id) id : vec3<u32>) {
    if (id.x >= frame.dimensionsAndFlags.x || id.y >= frame.dimensionsAndFlags.y) {
        return;
    }
    let pixel = vec2<i32>(id.xy);
    let world = textureLoad(worldPositionTexture, pixel, 0);
    if (world.a == 0.0) {
        textureStore(visibilityTexture, pixel, vec4<f32>(1.0, 0.0, 0.0, 1.0));
        return;
    }
    let normal = normalize(textureLoad(normalTexture, pixel, 0).xyz);
    let epsilon = frame.numerical.x;
    var lightDirection = normalize(-frame.lightVectorAndType.xyz);
    var tMax = frame.numerical.y;
    if (frame.lightVectorAndType.w > 0.5) {
        let toLight = frame.lightVectorAndType.xyz - world.xyz;
        let distanceToLight = length(toLight);
        if (distanceToLight <= epsilon) {
            textureStore(visibilityTexture, pixel, vec4<f32>(1.0, 0.0, 0.0, 1.0));
            return;
        }
        lightDirection = toLight / distanceToLight;
        tMax = distanceToLight - epsilon;
    }
    let orientedNormal = select(-normal, normal, dot(normal, lightDirection) >= 0.0);
    let ray = Ray(world.xyz + orientedNormal * epsilon, lightDirection);
    let visibility = select(1.0, 0.0, sceneOccluded(ray, epsilon, tMax));
    textureStore(visibilityTexture, pixel, vec4<f32>(visibility, 0.0, 0.0, 1.0));
}
