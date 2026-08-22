struct FrameUniforms {
    projection : mat4x4<f32>,
    view : mat4x4<f32>,
    model : mat4x4<f32>,
    inverseModel : mat4x4<f32>,
}

struct MaterialUniforms {
    baseColor : vec4<f32>,
    hasTexture : u32,
    _pad0 : u32,
    _pad1 : u32,
    _pad2 : u32,
}

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(1) @binding(0) var<uniform> material : MaterialUniforms;
@group(1) @binding(1) var materialSampler : sampler;
@group(1) @binding(2) var baseColorTexture : texture_2d<f32>;

struct VertexOut {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPosition : vec3<f32>,
    @location(1) worldNormal : vec3<f32>,
    @location(2) texCoord : vec2<f32>,
}

@vertex
fn vs_gbuffer(
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) texCoord : vec2<f32>,
) -> VertexOut {
    var out : VertexOut;
    let world = frame.model * vec4<f32>(position, 1.0);
    let inverseLinear = mat3x3<f32>(
        frame.inverseModel[0].xyz,
        frame.inverseModel[1].xyz,
        frame.inverseModel[2].xyz,
    );
    out.clipPosition = frame.projection * frame.view * world;
    out.worldPosition = world.xyz;
    out.worldNormal = normalize(transpose(inverseLinear) * normal);
    out.texCoord = texCoord;
    return out;
}

struct GBufferOut {
    @location(0) worldPosition : vec4<f32>,
    @location(1) normal : vec4<f32>,
    @location(2) albedo : vec4<f32>,
}

@fragment
fn fs_gbuffer(in : VertexOut) -> GBufferOut {
    var out : GBufferOut;
    var baseColor = material.baseColor;
    if (material.hasTexture != 0u) {
        baseColor *= textureSample(baseColorTexture, materialSampler, in.texCoord);
    }
    out.worldPosition = vec4<f32>(in.worldPosition, 1.0);
    out.normal = vec4<f32>(normalize(in.worldNormal), 1.0);
    out.albedo = vec4<f32>(baseColor.rgb, 1.0);
    return out;
}
