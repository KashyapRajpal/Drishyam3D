# Phase 3 — 3D Gaussian Splatting Renderer

Plan for adding a 3D Gaussian Splatting (3DGS) renderer on top of the WebGPU backend
delivered in Phase 2. This is the first of the two Phase 3 goals from the
[README roadmap](../README.md#phase-3-advanced-rendering-capabilities); hardware ray
tracing remains parked behind experimental WebGPU extensions.

## Goals

- Load a `.ply` 3D Gaussian Splatting scene and render it in real time in the existing canvas.
- Reuse the existing WebGPU device/context/camera and the React UI shell unchanged.
- Add splatting as a **new render mode** inside the WebGPU backend — the triangle
  pipeline (cube/sphere/glTF) keeps working untouched.
- Use **WebGPU compute shaders** for the per-frame depth sort — the GPGPU capability
  Phase 2 unlocked.

## Why this is a new mode, not a tweak

The current WebGPU path ([webgpu-scene.js](../scripts/engine/webgpu-scene.js)) is built for
**opaque indexed triangles**: 3 vertex buffers (pos/normal/uv), `drawIndexed`,
depth-test + depth-write on, back-face culling, no blending. Gaussian Splatting needs the
opposite of almost all of that:

| Aspect | Triangle pipeline (today) | Gaussian Splatting |
|---|---|---|
| Primitive | Indexed triangle mesh | Instanced quads (1 per splat), `triangle-strip` of 4 verts |
| Geometry source | Per-attribute vertex buffers | One **storage buffer** of splats |
| Ordering | Depth test (any order) | Must draw **back-to-front**, sorted every frame |
| Blending | None (opaque) | Premultiplied alpha-over, depth-test off / no depth write |
| Per-frame compute | None | Project to screen + **GPU sort** by view depth |
| Color | Single base color / texture | View-dependent (spherical harmonics) |

So the work is additive: new helpers, a new compute+render pass set, a new scene loop, a
new parser — selected by a `renderMode` flag, leaving the existing drawable path intact.

## Proposed File Structure

```
scripts/engine/
  app-facade.js            ← add 'webgpu-splat' route (or a renderMode option)
  webgpu-facade.js         ← unchanged (triangle backend)
  webgpu-splat-facade.js   ← NEW: init splat scene, load .ply, same public API shape
  webgpu-splat-scene.js    ← NEW: compute-sort + instanced-blend render loop
  splat-helpers.js         ← NEW: storage buffers, sort pipeline, blend pipeline
  ply-loader.js            ← NEW: parse binary .ply → typed splat arrays
  webgpu-helpers.js        ← reuse initWebGPU, createUniformBuffer, etc.

assets/shaders/
  splat.wgsl               ← NEW: @vertex projects splat→2D conic, @fragment Gaussian falloff
  splat-sort.wgsl          ← NEW: @compute depth-key generation + radix/bitonic sort
```

## Splat data model

Each Gaussian from a standard 3DGS `.ply` carries:

- `position` — `vec3<f32>`
- `opacity` — `f32` (stored as logit; apply sigmoid on load)
- `scale` — `vec3<f32>` (stored as log; apply exp on load)
- `rotation` — `vec4<f32>` quaternion (normalize on load)
- `sh` — spherical-harmonic coefficients for view-dependent color. Degree 0 = 3 floats
  (DC term ≈ base color); full degree 3 = 48 floats. **MVP uses degree 0 only.**

On the GPU these live in a single `array<Splat>` **storage buffer**. The 3D covariance
`Σ = R·S·Sᵀ·Rᵀ` is computed from scale+rotation (on load or in the vertex shader) and
projected to a 2D screen-space conic per frame.

## Step-by-Step Plan

### Step 1 — `ply-loader.js` (parse, no GPU)
Parse binary-little-endian `.ply`: read the header property list, then stream vertices into
flat `Float32Array`s (positions, opacities, scales, rotations, SH-DC colors) plus a
`splatCount`. Pure data, fully unit-testable with a small synthetic `.ply` fixture —
mirrors the data/GPU split already used in [geometry.js](../scripts/engine/geometry.js).

### Step 2 — `splat-helpers.js` (GPU resources)
- `createSplatStorageBuffer(device, splatData)` — `STORAGE | COPY_DST`.
- `createSortBuffers(device, count)` — depth keys + index buffer for the sort.
- `createSplatRenderPipeline(device, wgsl, format)` — `triangle-strip`, **blending on**
  (`src-alpha`/`one-minus-src-alpha`, premultiplied), depth-test **off**.
- `createSortPipeline(device, wgsl)` — `device.createComputePipeline`.

### Step 3 — `splat.wgsl` (render)
`@vertex`: read splat `i = indexBuffer[instance_index]`, build 2D conic from covariance +
camera, expand the 4-vertex quad to cover the projected ellipse, pass conic + color +
opacity. `@fragment`: evaluate `exp(-0.5·dᵀ·conic·d)` falloff × opacity → premultiplied
color. MVP: SH degree 0 (constant color); higher degrees are a follow-up.

### Step 4 — `splat-sort.wgsl` (compute)
`@compute` pass writes per-splat view-space depth keys, then sorts indices back-to-front.
**MVP: bitonic sort** (simpler, self-contained, fine for ≤~10⁶ splats). Upgrade path: GPU
radix sort for large scenes. Alternative MVP fallback: CPU `Array.sort` of an index typed
array each frame — slower but trivial to land first and swap out.

### Step 5 — `webgpu-splat-scene.js` (loop)
Per frame: update camera/uniforms → dispatch sort compute pass → `beginRenderPass`
(load existing color, no depth) → `setPipeline` + bind groups → `draw(4, splatCount)`
instanced → submit. Mirrors the lifecycle (`start`/`destroy`/`forceUpdate`) of
[webgpu-scene.js](../scripts/engine/webgpu-scene.js) so resource cleanup stays consistent.

### Step 6 — `webgpu-splat-facade.js` + dispatcher
Expose the same shape as `initWebGPUEngine` (`{ scene, camera, destroy, loadSplats }`).
Add a route in [app-facade.js](../scripts/engine/app-facade.js) (`backend: 'webgpu'` +
`renderMode: 'splat'`, or a `'webgpu-splat'` backend value).

### Step 7 — UI wiring (`ui/src/App.jsx`)
- A "Load Splat (.ply)" action (file input) → `loadSplats(arrayBuffer)`.
- Show a splat count / load progress indicator (parsing can take a moment).
- Guard: splat mode requires the WebGPU backend; disable/grey it under WebGL.

## Key Technical Considerations

| Topic | Detail |
|---|---|
| **Sort cost** | The depth sort dominates. Bitonic on GPU for MVP; radix sort later. Re-sort only when the camera moves enough to change order (optimization, not MVP). |
| **Memory** | 1M splats × ~ (3+1+3+4+3) floats ≈ 56 MB. Watch `maxStorageBufferBindingSize`; may need to chunk very large scenes. |
| **Blending** | Premultiplied alpha-over, back-to-front. Color must be premultiplied in the fragment shader. |
| **No depth buffer** | Splat pass disables depth-test/write; ordering comes entirely from the sort. (Mixing splats with triangle geometry in one scene is out of scope for MVP.) |
| **SH degree** | MVP = degree 0 (flat color). Degrees 1–3 add view-dependent shading at ~16× the color storage — a clear follow-up. |
| **Browser support** | Same WebGPU requirement as Phase 2 (Chrome/Edge 113+). Compute shaders are core WebGPU, no extension needed. |

## Scope

**Phase 3a (this effort):** Load a binary `.ply`, render with SH degree 0, GPU bitonic
depth sort, instanced billboard splatting. Backend switch in the existing Settings UI.

**Phase 3b (follow-up):** Full SH (view-dependent color), GPU radix sort for large scenes,
`.splat`/compressed formats, sort-skip optimization on small camera deltas.

**Phase 3c (parked):** Hardware-accelerated ray tracing — pending stable WebGPU ray-query
support.

### Pluggable WASM renderer backend (architecture sketch — deferred)

A **third rendering backend** alongside `webgl` and `webgpu`: a renderer written in C++/Rust
(against `wgpu` or Dawn) and compiled to **WASM**, plugged into the app and driving the GPU
**through WebGPU**. Goal is a *minimal, self-contained plug-in point* — not a full toolkit — so
you can drop in an external renderer module.

**Browser constraint (by design):** a WASM module in the browser reaches the GPU only via
WebGPU; it cannot use native Vulkan/Metal/DX12 (sandbox). Writing the plug-in against `wgpu`/
Dawn keeps the door open to a future native desktop build hitting native APIs, but that is
explicitly **out of scope** here — web/WebGPU only.

**Integration:** routes via the existing [app-facade.js](../scripts/engine/app-facade.js)
dispatcher (`backend: 'wasm'`) and is fronted by a thin `wasm-facade.js` that preserves the
public engine API, so the React UI is unchanged. The WASM module owns its own WebGPU context
on the canvas and its own draw loop; JS feeds it scene data and per-frame camera state.

**Minimal plug-in interface (wasm-bindgen / Emscripten exports):**
```
init(canvas) -> handle          // async: acquire adapter/device, configure context
loadSplats(handle, packed: Float32Array, count)
loadMesh(handle, positions, normals, texCoords, indices)
setCamera(handle, viewMatrix: Float32Array, projMatrix: Float32Array)
renderFrame(handle, dtSeconds)
resize(handle, width, height)
destroy(handle)
```
Data crosses the boundary as the same flat typed arrays produced by `ply-loader.js` /
`packSplats` and `geometry.js`, so no new data formats are introduced. Deferred: define the
interface now, implement after 3a ships.

## Execution Order

1. Step 1 (`ply-loader.js`) — pure data, land first with tests.
2. Step 2–4 (helpers, render shader, sort shader) — the GPU core; prove with a CPU-sort fallback before the compute sort.
3. Step 5 (scene loop) — wire compute + render passes together.
4. Step 6 (facade + dispatcher) — thin glue.
5. Step 7 (UI) — file load + mode switch, last.
