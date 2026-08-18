struct LightUniforms {
    vectorAndType : vec4<f32>,
    colorAndIntensity : vec4<f32>,
    ambientExposure : vec4<f32>,
    _reserved : vec4<f32>,
}

@group(0) @binding(0) var worldPositionTexture : texture_2d<f32>;
@group(0) @binding(1) var albedoTexture : texture_2d<f32>;
@group(0) @binding(2) var normalTexture : texture_2d<f32>;
@group(0) @binding(3) var visibilityTexture : texture_2d<f32>;
@group(0) @binding(4) var<uniform> light : LightUniforms;

struct FullscreenOut {
    @builtin(position) position : vec4<f32>,
}

@vertex
fn vs_composite(@builtin(vertex_index) vertexIndex : u32) -> FullscreenOut {
    let positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var out : FullscreenOut;
    out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    return out;
}

fn linearToSrgb(value : vec3<f32>) -> vec3<f32> {
    let low = value * 12.92;
    let high = 1.055 * pow(max(value, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(high, low, value <= vec3<f32>(0.0031308));
}

@fragment
fn fs_composite(in : FullscreenOut) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(in.position.xy);
    let albedo = textureLoad(albedoTexture, pixel, 0);
    if (albedo.a == 0.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let worldPosition = textureLoad(worldPositionTexture, pixel, 0).xyz;
    let normal = normalize(textureLoad(normalTexture, pixel, 0).xyz);
    let shadowSize = vec2<i32>(textureDimensions(visibilityTexture));
    let shadowPixel = clamp(pixel, vec2<i32>(0), shadowSize - vec2<i32>(1));
    let visibility = textureLoad(visibilityTexture, shadowPixel, 0).r;

    var lightDirection = normalize(-light.vectorAndType.xyz);
    var attenuation = 1.0;
    if (light.vectorAndType.w > 0.5) {
        let toLight = light.vectorAndType.xyz - worldPosition;
        let distanceSquared = max(dot(toLight, toLight), 1e-4);
        lightDirection = toLight * inverseSqrt(distanceSquared);
        attenuation = 1.0 / max(distanceSquared, 1.0);
    }
    let direct = visibility * max(dot(normal, lightDirection), 0.0)
        * light.colorAndIntensity.w * attenuation;
    let linear = albedo.rgb * (
        vec3<f32>(light.ambientExposure.x)
        + light.colorAndIntensity.rgb * direct
    );
    let exposed = linear * light.ambientExposure.y;
    let mapped = exposed / (vec3<f32>(1.0) + exposed);
    return vec4<f32>(linearToSrgb(mapped), 1.0);
}
