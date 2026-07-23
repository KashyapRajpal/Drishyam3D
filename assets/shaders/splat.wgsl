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
    // Coefficients per splat actually stored in shCoeffs. This is fixed by the
    // loaded scene and is NOT the same as shDegree: clamping the displayed degree
    // must not change the buffer stride, or reads go out of alignment.
    shStride : u32,
    _pad0    : u32,
    camPos   : vec3<f32>, // world-space eye, for view-dependent SH
    shDegree : u32,       // degrees to evaluate; 0 = DC only
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
// Non-DC SH, coefficient-major rgb triples. Flat f32 rather than array<vec3<f32>>,
// whose 16-byte alignment would waste 4 bytes per coefficient.
@group(0) @binding(3) var<storage, read> shCoeffs : array<f32>;

// Real-SH basis constants for degrees 1-3.
const SH_C1 : f32 = 0.4886025119029199;
const SH_C2 = array<f32, 5>(
     1.0925484305920792, -1.0925484305920792,  0.31539156525252005,
    -1.0925484305920792,  0.5462742152960396,
);
const SH_C3 = array<f32, 7>(
    -0.5900435899266435,  2.890611442640554,  -0.4570457994644658,
     0.3731763325901154, -0.4570457994644658,  1.445305721320277,
    -0.5900435899266435,
);

fn shCoeff(base : u32, k : u32) -> vec3<f32> {
    let o = base + k * 3u;
    return vec3<f32>(shCoeffs[o], shCoeffs[o + 1u], shCoeffs[o + 2u]);
}

/// View-dependent colour offset added to the DC term. `dir` must be normalized.
fn evalSh(splatIndex : u32, dir : vec3<f32>) -> vec3<f32> {
    if (params.shDegree == 0u) {
        return vec3<f32>(0.0);
    }
    // Stride comes from the buffer, not the displayed degree.
    let base = splatIndex * params.shStride * 3u;
    let x = dir.x;
    let y = dir.y;
    let z = dir.z;

    var result = SH_C1 * (-y * shCoeff(base, 0u) + z * shCoeff(base, 1u) - x * shCoeff(base, 2u));

    if (params.shDegree >= 2u) {
        let xx = x * x; let yy = y * y; let zz = z * z;
        let xy = x * y; let yz = y * z; let xz = x * z;
        result += SH_C2[0] * xy * shCoeff(base, 3u)
                + SH_C2[1] * yz * shCoeff(base, 4u)
                + SH_C2[2] * (2.0 * zz - xx - yy) * shCoeff(base, 5u)
                + SH_C2[3] * xz * shCoeff(base, 6u)
                + SH_C2[4] * (xx - yy) * shCoeff(base, 7u);

        if (params.shDegree >= 3u) {
            result += SH_C3[0] * y * (3.0 * xx - yy) * shCoeff(base, 8u)
                    + SH_C3[1] * xy * z * shCoeff(base, 9u)
                    + SH_C3[2] * y * (4.0 * zz - xx - yy) * shCoeff(base, 10u)
                    + SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoeff(base, 11u)
                    + SH_C3[4] * x * (4.0 * zz - xx - yy) * shCoeff(base, 12u)
                    + SH_C3[5] * z * (xx - yy) * shCoeff(base, 13u)
                    + SH_C3[6] * x * (xx - 3.0 * yy) * shCoeff(base, 14u);
        }
    }
    return result;
}

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

    let si = indices[iid];
    let s = splats[si];
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

    // View-dependent colour: DC term (already baked to 0.5 + SH_C0*f_dc on load)
    // plus the non-DC SH contribution, clamped to non-negative as per 3DGS.
    let viewDir = normalize(center - params.camPos);
    let rgb = max(s.colorOpacity.rgb + evalSh(si, viewDir), vec3<f32>(0.0));

    out.position = vec4<f32>(centerNDC + offset, 0.0, 1.0);
    out.color = vec4<f32>(rgb, s.colorOpacity.a);
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
