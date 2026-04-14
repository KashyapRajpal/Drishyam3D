# WebGPU Migration Plan (Phase 2)

Plan for adding a WebGPU rendering backend to Drishyam3D alongside the existing WebGL 1.0 backend.

## Goals

- Introduce WebGPU as a selectable rendering backend.
- Keep the existing WebGL backend working — the user picks via a Settings dropdown.
- Preserve the public engine API so React/UI code does not need to change.
- Enable future Phase 3 work (compute shaders, Gaussian Splatting, ray tracing).

## Current Architecture Observations

Three tight coupling points need to be addressed:

1. **[scripts/engine/geometry.js](../scripts/engine/geometry.js)** mixes geometry *data generation* with WebGL *buffer creation* — needs splitting.
2. **[scripts/engine/app-facade.js](../scripts/engine/app-facade.js)** is WebGL-specific — needs a parallel WebGPU facade with the same API surface.
3. **[ui/src/App.jsx:104](../ui/src/App.jsx#L104)** already has `const [backend, setBackend] = useState('webgl')` — just needs wiring.

## Proposed File Structure

```
scripts/engine/
  app-facade.js          ← becomes a dispatcher (webgl vs webgpu)
  webgl-facade.js        ← current app-facade.js, renamed
  webgpu-facade.js       ← NEW: WebGPU backend, same public API
  webgpu-helpers.js      ← NEW: device init, pipeline, buffer utilities
  webgpu-scene.js        ← NEW: WebGPU render loop
  geometry.js            ← REFACTOR: split data generation from buffer creation
  scene.js               ← unchanged (WebGL only)
  webgl-helpers.js       ← unchanged
  matrix.js              ← unchanged (pure math, shared)
  camera.js              ← unchanged (shared)

assets/shaders/
  default.vert           ← unchanged (GLSL, WebGL)
  default.frag           ← unchanged (GLSL, WebGL)
  default.wgsl           ← NEW: WGSL shader (vertex + fragment combined)
```

## Step-by-Step Plan

### Step 1 — Refactor `geometry.js` (data / GPU-buffer split)

Today `initCubeBuffers(gl)` and `createSphere(gl)` generate data *and* upload to WebGL in one shot. Split them:

- `generateCubeData()` → returns `{ positions, normals, texCoords, indices }` as plain typed arrays.
- `generateSphereData()` → same treatment.
- `initCubeBuffers(gl)` → calls `generateCubeData()`, then uploads to WebGL (existing callers unchanged).
- `createSphere(gl)` → same treatment.
- Export the data generators so the WebGPU backend can consume them without a GL context.

This is non-breaking and unblocks everything else.

### Step 2 — Write the WGSL shader

Create [assets/shaders/default.wgsl](../assets/shaders/default.wgsl). WGSL uses a single file containing both `@vertex` and `@fragment` entry points. It needs to replicate the current GLSL lighting model (ambient + directional light + optional texture + base color).

```wgsl
struct Uniforms {
  projectionMatrix : mat4x4<f32>,
  modelViewMatrix  : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Material {
  baseColor  : vec4<f32>,
  hasTexture : u32,
}
@group(0) @binding(1) var<uniform> material : Material;
@group(0) @binding(2) var uSampler : sampler;
@group(0) @binding(3) var uTexture : texture_2d<f32>;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) vLighting      : vec3<f32>,
  @location(1) vTexCoord      : vec2<f32>,
}

@vertex fn vs_main(
  @location(0) aPosition : vec3<f32>,
  @location(1) aNormal   : vec3<f32>,
  @location(2) aTexCoord : vec2<f32>,
) -> VertexOut { /* ... */ }

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4<f32> { /* ... */ }
```

### Step 3 — `webgpu-helpers.js`

Utility functions for WebGPU initialization and resource creation:

```
initWebGPU(canvas)               // navigator.gpu.requestAdapter → device → configure context
createRenderPipeline(device, wgslSource, swapchainFormat)
createVertexBuffer(device, data) // GPUBufferUsage.VERTEX | COPY_DST
createIndexBuffer(device, data)  // GPUBufferUsage.INDEX  | COPY_DST
createUniformBuffer(device, size)// GPUBufferUsage.UNIFORM | COPY_DST
writeBuffer(device, buffer, data)// device.queue.writeBuffer(...)
createTexture(device, imageBitmap)
createDefaultTexture(device)     // 1x1 white
createBindGroup(device, pipeline, uniformBuffers, texture, sampler)
```

### Step 4 — `webgpu-scene.js`

WebGPU render loop — structurally mirrors `scene.js` but uses command encoders:

```
render():
  1.  Resize canvas if needed (reconfigure context)
  2.  Update matrices (same sceneState.modelViewMatrix pattern)
  3.  device.queue.writeBuffer(matrixUB, uniforms)
  4.  encoder = device.createCommandEncoder()
  5.  pass = encoder.beginRenderPass({ colorAttachment: context.getCurrentTexture() })
  6.  pass.setPipeline(pipeline)
  7.  pass.setBindGroup(0, bindGroup)
  8.  pass.setVertexBuffer(0/1/2, pos/normal/uv)
  9.  pass.setIndexBuffer(indexBuffer, 'uint16')
  10. pass.drawIndexed(vertexCount)
  11. pass.end()
  12. device.queue.submit([encoder.finish()])
  13. requestAnimationFrame(render)
```

### Step 5 — `webgpu-facade.js`

Exposes the **identical public API** as the current `app-facade.js`:

```js
export async function initWebGPUEngine({ canvas, shaderSources, scriptSource, onError }) {
  // shaderSources.wgsl (instead of .vertex / .fragment)
  // ...
  return { device, scene, camera, setShaders, setScriptSource }
}
```

`setShaders(wgslSource)` recreates the `GPURenderPipeline` — WebGPU pipeline compilation is async but fast.

### Step 6 — Update `app-facade.js` as a dispatcher

```js
export async function initEngine({ canvas, backend = 'webgl', shaderSources, scriptSource, onError }) {
  if (backend === 'webgpu') return initWebGPUEngine(/* ... */)
  return initWebGLEngine(/* ... */)  // current logic, moved to webgl-facade.js
}
```

### Step 7 — Update [ui/src/App.jsx](../ui/src/App.jsx)

1. Wire the `backend` state to a **Settings menu dropdown** (WebGL / WebGPU).
2. Pass `backend` to `initEngine`.
3. For WebGPU, swap shader sources: pass `wgsl` source instead of `vertex` / `fragment`.
4. Show a graceful error banner if `navigator.gpu` is unavailable.
5. Add `default.wgsl` to the Explorer's "Shaders" group so it's editable when WebGPU is active.

## Key Technical Considerations

| Topic | Detail |
|---|---|
| **Browser support** | WebGPU requires Chrome 113+ / Edge 113+ (flag in Firefox). Need a capability check at startup. |
| **Shader editor UX** | WebGL = two files (`.vert` + `.frag`); WebGPU = one `.wgsl` file. Active tab set depends on backend. |
| **User scripts** | The `sceneState.modelViewMatrix` pattern carries over unchanged — script modifies a JS matrix, we upload it to the uniform buffer each frame. |
| **GLTF models** | `gltf-parser.js` calls `gl.createBuffer()` directly — needs a WebGPU-compatible path. Deferred to Phase 2b. |
| **Depth buffer** | WebGL: `gl.enable(gl.DEPTH_TEST)`. WebGPU: depth texture is an explicit `GPUTexture` attached to the render-pass descriptor. |
| **Resize handling** | `context.configure()` must be re-called on canvas resize in WebGPU (vs just `gl.viewport()` in WebGL). |

## What Stays the Same

- [scripts/engine/matrix.js](../scripts/engine/matrix.js) — pure math, zero changes.
- [scripts/engine/camera.js](../scripts/engine/camera.js) — zero changes.
- [scripts/scene-script.js](../scripts/scene-script.js) — zero changes (user API unchanged).
- React UI layout — zero changes.

## Scope

**Phase 2a (this effort):** Primitives (cube / sphere) rendering in WebGPU, backend switcher in Settings, WGSL shader editing.

**Phase 2b (follow-up):** WebGPU-compatible GLTF loading — refactor `gltf-parser.js`.

**Phase 3:** Compute shaders, Gaussian Splatting, ray tracing (see main [README](../README.md#phase-3-advanced-rendering-capabilities)).

## Execution Order

1. Step 1 (geometry refactor) — non-breaking, land first.
2. Step 2 (WGSL shader) — self-contained asset.
3. Steps 3–5 (helpers, scene, facade) — the bulk of the WebGPU backend.
4. Step 6 (dispatcher) — thin glue.
5. Step 7 (UI wiring) — last, once backends are proven in isolation.
