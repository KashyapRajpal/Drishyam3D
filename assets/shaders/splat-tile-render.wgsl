/**
 * @file Tile compositor (WebGPU backend).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Step 1 (scaffold): a compute pass writes a test gradient into the output
 * storage texture, proving the compute → storage-texture → blit path before any
 * splat math. This grows into the per-tile shared-memory front-to-back
 * compositor (Kerbl et al. 2023) in a later step.
 */

@group(0) @binding(0) var outTex : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn cs_test_pattern(@builtin(global_invocation_id) gid : vec3<u32>) {
    let dims = textureDimensions(outTex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }
    // Red ramps along x, green along y, blue constant — a legible gradient that
    // confirms both texture axes map correctly through the blit.
    let r = f32(gid.x) / f32(dims.x);
    let g = f32(gid.y) / f32(dims.y);
    textureStore(outTex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(r, g, 0.5, 1.0));
}
