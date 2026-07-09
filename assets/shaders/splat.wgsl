// 3D Gaussian Splatting render shader (WebGPU backend).
// vs_main/fs_main: full EWA splatting (instanced quads, premultiplied alpha).
// vs_debug_points/fs_debug_points: debug draw of splat centers as points.
//
// Splat layout matches packSplats() in splat-helpers.js (16 floats / 64 bytes):
//   posPad: xyz + pad | colorOpacity: rgb + a | covA: σxx,σxy,σxz | covB: σyy,σyz,σzz

struct RenderParams {
    proj     : mat4x4<f32>,
    view     : mat4x4<f32>,
    viewport : vec2<f32>,
    _pad     : vec2<f32>,
}

struct Splat {
    posPad       : vec4<f32>,
    colorOpacity : vec4<f32>,
    covA         : vec4<f32>, // σxx, σxy, σxz
    covB         : vec4<f32>, // σyy, σyz, σzz
}

@group(0) @binding(0) var<uniform> params : RenderParams;
@group(0) @binding(1) var<storage, read> splats : array<Splat>;
@group(0) @binding(2) var<storage, read> indices : array<u32>;

struct VertexOut {
    @builtin(position) position : vec4<f32>,
    @location(0)       color    : vec4<f32>,
    @location(1)       local    : vec2<f32>, // quad corner in [-2, 2]
}

// Quad corners for a 4-vertex triangle-strip (BL, BR, TL, TR).
const QUAD = array<vec2<f32>, 4>(
    vec2<f32>(-2.0, -2.0),
    vec2<f32>( 2.0, -2.0),
    vec2<f32>(-2.0,  2.0),
    vec2<f32>( 2.0,  2.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VertexOut {
    var out : VertexOut;

    let s = splats[indices[iid]];
    let center = s.posPad.xyz;
    let cam = params.view * vec4<f32>(center, 1.0);
    let pos2d = params.proj * cam;

    // Cull splats behind the camera / outside the guard band.
    if (pos2d.w <= 0.0) {
        out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0); // offscreen
        return out;
    }

    // Pixel focal lengths from the projection matrix.
    let focal = vec2<f32>(
        0.5 * params.viewport.x * params.proj[0][0],
        0.5 * params.viewport.y * params.proj[1][1],
    );

    // Reconstruct the symmetric 3D covariance.
    let Vrk = mat3x3<f32>(
        vec3<f32>(s.covA.x, s.covA.y, s.covA.z),
        vec3<f32>(s.covA.y, s.covB.x, s.covB.y),
        vec3<f32>(s.covA.z, s.covB.y, s.covB.z),
    );

    // Jacobian of the perspective projection at the splat center (column-major).
    let J = mat3x3<f32>(
        vec3<f32>(focal.x / cam.z, 0.0, -(focal.x * cam.x) / (cam.z * cam.z)),
        vec3<f32>(0.0, -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z)),
        vec3<f32>(0.0, 0.0, 0.0),
    );

    // W = view rotation (upper-left 3x3), transposed.
    let W = transpose(mat3x3<f32>(
        params.view[0].xyz, params.view[1].xyz, params.view[2].xyz,
    ));
    let T = W * J;
    var cov2d = transpose(T) * Vrk * T;

    // Low-pass filter (0.1 antialiasing) to keep sub-pixel splats visible without excessive blur.
    let a = cov2d[0][0] + 0.1;
    let d = cov2d[1][1] + 0.1;
    let b = cov2d[0][1];

    let det = a * d - b * b;
    let mid = 0.5 * (a + d);
    let discriminant = mid * mid - det;
    let lambda1 = mid + sqrt(max(0.01, discriminant));
    let lambda2 = mid - sqrt(max(0.01, discriminant));

    // Avoid division by zero in normalization; compute robust principal axes.
    let axis_delta = lambda1 - a;
    let diagonal = normalize(vec2<f32>(b, axis_delta + 1e-8));
    let majorAxis = min(sqrt(max(0.0, 2.0 * lambda1)), 512.0) * diagonal;
    let minorAxis = min(sqrt(max(0.0, 2.0 * lambda2)), 512.0) * vec2<f32>(diagonal.y, -diagonal.x);

    let corner = QUAD[vid];
    let centerNDC = pos2d.xy / pos2d.w;
    let offset = (corner.x * majorAxis + corner.y * minorAxis) / params.viewport;

    out.position = vec4<f32>(centerNDC + offset, 0.0, 1.0);
    out.color = s.colorOpacity;
    out.local = corner;
    return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
    // Gaussian falloff over the quad; corner range [-2,2] ~ 2 std-devs.
    let power = -dot(in.local, in.local);
    if (power < -4.0) {
        discard;
    }
    let alpha = in.color.a * exp(power);
    if (alpha < 0.00392) { // < 1/255
        discard;
    }
    return vec4<f32>(in.color.rgb * alpha, alpha); // premultiplied
}

// ---- Debug draw: splat centers as points (no sort, no blend) ----

struct DebugOut {
    @builtin(position) position : vec4<f32>,
    @location(0)       color    : vec3<f32>,
}

@vertex
fn vs_debug_points(@builtin(vertex_index) vid : u32) -> DebugOut {
    var out : DebugOut;
    let s = splats[vid];
    out.position = params.proj * params.view * vec4<f32>(s.posPad.xyz, 1.0);
    out.color = s.colorOpacity.rgb;
    return out;
}

@fragment
fn fs_debug_points(in : DebugOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
