// Default WGSL shader for the WebGPU backend.
// Mirrors the lighting model of default.vert / default.frag.

struct Uniforms {
    projectionMatrix : mat4x4<f32>,
    modelViewMatrix  : mat4x4<f32>,
}

struct Material {
    baseColor  : vec4<f32>,
    hasTexture : u32,
    _pad0 : u32,
    _pad1 : u32,
    _pad2 : u32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<uniform> material : Material;
@group(0) @binding(2) var uSampler : sampler;
@group(0) @binding(3) var uTexture : texture_2d<f32>;

struct VertexOut {
    @builtin(position) position  : vec4<f32>,
    @location(0)       vLighting : vec3<f32>,
    @location(1)       vTexCoord : vec2<f32>,
}

@vertex
fn vs_main(
    @location(0) aPosition : vec3<f32>,
    @location(1) aNormal   : vec3<f32>,
    @location(2) aTexCoord : vec2<f32>,
) -> VertexOut {
    var out : VertexOut;
    out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4<f32>(aPosition, 1.0);

    let ambientLight           = vec3<f32>(0.3, 0.3, 0.3);
    let directionalLightColor  = vec3<f32>(1.0, 1.0, 1.0);
    let directionalVector      = normalize(vec3<f32>(0.85, 0.8, 0.75));

    let directional = max(dot(aNormal, directionalVector), 0.0);
    out.vLighting = ambientLight + directionalLightColor * directional;
    out.vTexCoord = aTexCoord;
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    var texColor = vec4<f32>(1.0, 1.0, 1.0, 1.0);
    if (material.hasTexture != 0u) {
        texColor = textureSample(uTexture, uSampler, in.vTexCoord);
    }
    return material.baseColor * texColor * vec4<f32>(in.vLighting, 1.0);
}
