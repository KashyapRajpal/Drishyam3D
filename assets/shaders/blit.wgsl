/**
 * @file Fullscreen blit: sampled texture → swapchain.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Renders a fullscreen triangle that reads the tile renderer's output texture
 * (written by a compute pass) and blits it to the swapchain render target.
 */

@group(0) @binding(0) var srcTex : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4<f32> {
    // Oversized fullscreen triangle covering the whole clip space.
    let pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    return vec4<f32>(pos[idx], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragCoord : vec4<f32>) -> @location(0) vec4<f32> {
    // fragCoord is in pixels; the source texture is 1:1 with the framebuffer.
    let coords = vec2<i32>(i32(fragCoord.x), i32(fragCoord.y));
    return textureLoad(srcTex, coords, 0);
}
