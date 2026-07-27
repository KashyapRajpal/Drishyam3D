// Frustum culling for the Culled reduction (WebGPU backend).
//
// cull_cells:  one thread per grid cell → test the cell AABB against the six
//   frustum planes → cellVisible[c] = 0/1. O(cellCount) tests, mirroring
//   aabbInFrustum() in ordering/spatial/frustum.js (unit-tested there).
// apply_cull:  one thread per splat → find its grid cell; if that cell is culled,
//   sink the splat's sort key past the visible set; otherwise bump the visible
//   instance count. The bitonic sort then pushes visible splats to the front and
//   drawIndirect renders only instanceCount of them. Depends on compute_keys
//   having already written keys[i]; this only masks them (splat-sort.wgsl is
//   left untouched).

struct CullParams {
    planes    : array<vec4<f32>, 6>, // world-space frustum planes (a,b,c,d)
    gridMin   : vec3<f32>,
    cellSize  : vec3<f32>,
    dim       : u32,
    cellCount : u32,
    splatCount: u32,
    _pad      : u32,
}

struct Splat {
    posPad       : vec4<f32>,
    colorOpacity : vec4<f32>,
    covA         : vec4<f32>,
    covB         : vec4<f32>,
}

@group(0) @binding(0) var<uniform>             cp           : CullParams;
@group(0) @binding(1) var<storage, read_write> cellVisible  : array<u32>;
@group(0) @binding(2) var<storage, read>       splats       : array<Splat>;
@group(0) @binding(3) var<storage, read_write> keys         : array<f32>;
@group(0) @binding(4) var<storage, read_write> indirectArgs : array<atomic<u32>>;

const FAR_KEY : f32 = 3.0e38;

// Conservative positive-vertex AABB test (mirrors frustum.js aabbInFrustum).
fn aabbInFrustum(lo : vec3<f32>, hi : vec3<f32>) -> bool {
    for (var i = 0u; i < 6u; i = i + 1u) {
        let pl = cp.planes[i];
        let px = select(lo.x, hi.x, pl.x >= 0.0);
        let py = select(lo.y, hi.y, pl.y >= 0.0);
        let pz = select(lo.z, hi.z, pl.z >= 0.0);
        if (pl.x * px + pl.y * py + pl.z * pz + pl.w < 0.0) {
            return false;
        }
    }
    return true;
}

fn clampCell(t : f32, dim : u32) -> u32 {
    if (t < 0.0) { return 0u; }
    let c = u32(floor(t));
    if (c >= dim) { return dim - 1u; }
    return c;
}

@compute @workgroup_size(64)
fn cull_cells(@builtin(global_invocation_id) gid : vec3<u32>) {
    let c = gid.x;
    if (c >= cp.cellCount) { return; }
    let dim = cp.dim;
    let cx = c % dim;
    let cy = (c / dim) % dim;
    let cz = c / (dim * dim);
    let lo = cp.gridMin + vec3<f32>(f32(cx), f32(cy), f32(cz)) * cp.cellSize;
    let hi = lo + cp.cellSize;
    cellVisible[c] = select(0u, 1u, aabbInFrustum(lo, hi));
}

@compute @workgroup_size(256)
fn apply_cull(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= cp.splatCount) { return; }
    let p = splats[i].posPad.xyz;
    // Quantize to a cell (mirrors buildGrid in grid.js).
    let rel = (p - cp.gridMin) / cp.cellSize;
    let cx = clampCell(rel.x, cp.dim);
    let cy = clampCell(rel.y, cp.dim);
    let cz = clampCell(rel.z, cp.dim);
    let cell = (cz * cp.dim + cy) * cp.dim + cx;
    if (cellVisible[cell] == 0u) {
        keys[i] = FAR_KEY;                  // sink culled splats past the visible set
    } else {
        atomicAdd(&indirectArgs[1], 1u);    // instanceCount++
    }
}
