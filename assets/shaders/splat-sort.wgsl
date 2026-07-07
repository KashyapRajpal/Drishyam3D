// GPU depth sort for Gaussian splats (bitonic sort).
//
// compute_keys: per splat, write a view-space depth key and seed indices[i]=i.
//   key = view-space z (negative in front). Sorting ASCENDING => most-negative
//   (farthest) first => correct back-to-front draw order. Padding entries get a
//   very large key so they sink past the real `count` (never drawn).
//
// bitonic_step: one compare-exchange stage. The host dispatches O(log²N) stages.
//   The (k, j) pair for each stage is camera-independent, so it lives in a
//   precomputed StepParams buffer (one 256B-aligned slice per stage) bound at a
//   static offset — no per-dispatch uniform writes.

struct KeysParams {
    view   : mat4x4<f32>,
    count  : u32, // real splat count
    padded : u32, // power-of-two padded count
    _pad0  : u32,
    _pad1  : u32,
}

struct StepParams {
    k      : u32, // current bitonic block size
    j      : u32, // current partner stride
    padded : u32,
    _pad   : u32,
}

struct Splat {
    posPad       : vec4<f32>,
    colorOpacity : vec4<f32>,
    covA         : vec4<f32>,
    covB         : vec4<f32>,
}

@group(0) @binding(0) var<uniform>             kp      : KeysParams;
@group(0) @binding(1) var<storage, read>       splats  : array<Splat>;
@group(0) @binding(2) var<storage, read_write> keys    : array<f32>;
@group(0) @binding(3) var<storage, read_write> indices : array<u32>;
@group(0) @binding(4) var<uniform>             sp      : StepParams;

const FAR_KEY : f32 = 3.0e38;

@compute @workgroup_size(256)
fn compute_keys(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= kp.padded) {
        return;
    }
    indices[i] = i;
    if (i < kp.count) {
        let viewPos = kp.view * vec4<f32>(splats[i].posPad.xyz, 1.0);
        keys[i] = viewPos.z; // ascending sort => farthest (most negative) first
    } else {
        keys[i] = FAR_KEY;   // padding sinks to the end
    }
}

@compute @workgroup_size(256)
fn bitonic_step(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= sp.padded) {
        return;
    }
    let partner = i ^ sp.j;
    // Each pair is handled once, by its lower index.
    if (partner <= i) {
        return;
    }

    // Sort direction for this block: ascending when the k-bit of i is 0.
    let ascending = (i & sp.k) == 0u;
    let ki = keys[i];
    let kpart = keys[partner];

    if ((ki > kpart) == ascending) {
        keys[i] = kpart;
        keys[partner] = ki;
        let ti = indices[i];
        indices[i] = indices[partner];
        indices[partner] = ti;
    }
}
