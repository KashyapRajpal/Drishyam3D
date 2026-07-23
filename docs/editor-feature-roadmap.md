# Editor Feature Roadmap

Plan for the next round of **editor** (not renderer) capabilities in Drishyam3D. Parked while
Phase 3b/3c renderer work proceeds — see [gaussian-splatting-plan.md](./gaussian-splatting-plan.md).

## Context

The editor today can edit the single default shader (WGSL / vert+frag) and the scene script,
apply them live, and load meshes/splats. We want six new capabilities: **save/load real files, a
render-mode compare slider, a debug/stats overlay, texture upload, multi-texture materials, and an
authorable post-processing effects framework**.

### Scope decisions

- **Compare slider** = *render-mode* compare (textured vs untextured, lit vs points, effect on vs
  off) — a wipe divider on the viewport, same GPU context on both sides.
- **Effects** = a small **SDK-style framework** (authors add their own shader-pass files), shipped
  with example effects (blur + depth-of-field).
- **Save/load** = **real files on disk** via the File System Access API (download fallback).
- **Effects + multi-texture must work on BOTH backends** (WebGL 1.0 and WebGPU).

Work is phased so each phase is independently shippable. Early phases build plumbing later ones
reuse (engine→UI stats channel, generalized editable-file model, offscreen-render refactor).

### Architecture facts this plan relies on

- WebGPU: [webgpu-scene.js](../scripts/engine/webgpu-scene.js) owns the RAF loop + per-frame `frame`
  object and dispatches to a `Renderer` registry ([mesh-renderer.js](../scripts/engine/renderers/mesh-renderer.js),
  [splat-renderer.js](../scripts/engine/renderers/splat-renderer.js)). Renderers `beginRenderPass`
  straight onto the swapchain view.
- WebGL: [scene.js](../scripts/engine/scene.js) is a monolithic `render()` writing to the default
  framebuffer. It carries legacy `console.log`/`console.trace` noise worth removing while here.
- Facades ([webgpu-facade.js](../scripts/engine/webgpu-facade.js),
  [webgl-facade.js](../scripts/engine/webgl-facade.js)) expose the public engine object consumed by
  [App.jsx](../ui/src/App.jsx). New engine capabilities are added as methods there.
- `App.jsx` holds editable content in React state seeded from Vite `?raw` glob imports; the editable
  set + apply routing are **hardcoded** to the 4 default files and must be generalized.
- Texture helpers exist: `createTextureFromImageBitmap` / `createTextureFromUrl` in
  [webgpu-helpers.js](../scripts/engine/webgpu-helpers.js).
- User-script trust boundary is [script-runtime.js](../scripts/engine/script-runtime.js)
  (`compileUserScript` via `new Function`); keep code execution confined there — loaded external
  engine `.js` files stay view/edit-only, never executed.

---

## Phase 0 — Debug/stats overlay + engine→UI stats channel

*Small. Establishes the stats channel reused by Compare and Effects.*

- **Engine:** in both scene cores, maintain a rolling FPS (EMA over `deltaTime`) and expose
  `engine.getStats()` → `{ backend, fps, frameMs, drawableKind, triangleCount, vertexCount, splatCount }`.
  `triangleCount = drawable.vertexCount/3` for meshes; `splatCount = drawable.count` for splats.
  Add `getStats` to the object returned by both facades.
- **UI:** a `StatsOverlay` component absolutely positioned over the viewport, polling
  `engine.getStats()` on a ~4 Hz interval (NOT per-frame, to avoid React churn). Toggle via a
  Settings menu item "Show Stats".
- **Files:** `webgpu-scene.js`, `scene.js`, both facades, `App.jsx`, `styles.css`.

## Phase 1 — Save/Load real files + generalized editable-file model

*Unlocks authoring shaders/effects as real files and re-opening them.*

- **New helper** `ui/src/lib/fileAccess.js`: `openTextFile()` (`showOpenFilePicker`, fallback
  `<input type=file>`), `saveTextFile(handle, text)`, `saveTextFileAs(text, suggestedName)`
  (`showSaveFilePicker`, fallback Blob download). Keep the `FileSystemFileHandle` for silent re-save.
- **Generalize App.jsx editable model:** replace hardcoded `isEditable` / `editableDefaults` / apply
  routing with a per-tab descriptor `{ path, role, handle? }` where
  `role ∈ {script, wgsl, vert, frag, effect, readonly}`. `handleApply` dispatches by `role` rather
  than comparing against 4 fixed paths. Opened external files become editable tabs with a role
  inferred from extension.
- **Editor footer:** **Save** (Cmd/Ctrl+S → write back to stored handle), **Save As…**, and
  **File ▸ Open File…** to load an external shader/script/effect into a new tab.
- **Files:** `App.jsx` (largest change), new `ui/src/lib/fileAccess.js`, `styles.css`.

## Phase 2 — Texture upload for the current object (single texture)

- **Engine:** add `engine.setObjectTexture(imageBitmap)` to both facades. WebGPU builds a texture via
  `createTextureFromImageBitmap`, assigns to `drawable.texture`, calls the mesh renderer's `prepare()`
  (forces bind-group rebuild) + `forceUpdate`. WebGL uploads the bitmap to a GL texture and sets
  `drawable.texture` (the render loop already honors `drawable.texture` + `uHasTexture`).
- **UI:** Shapes (or a new **Texture**) menu → "Load Texture…" → image picker → `createImageBitmap`
  → `engine.setObjectTexture`.
- **Files:** both facades, `webgpu-helpers.js` / `geometry.js`, `App.jsx`.

## Phase 3 — Split-screen render-mode compare (wipe slider)

*Same context both sides; scissor-based. Mesh path first (splat compare deferred).*

- **Engine:** add a compare controller to both scene cores:
  `engine.setCompareMode({ enabled, split, left, right })` where `left`/`right` are render-mode ids
  (`textured`, `untextured`, `lit`, `points`, later `effect-on`/`effect-off`). Each frame, draw the
  scene twice with a scissor rect: left `[0..split·w]` mode A, right `[split·w..w]` mode B.
  - WebGPU: two `beginRenderPass`es (pass 2 `loadOp:'load'`), each with `pass.setScissorRect(...)`.
  - WebGL: `gl.enable(SCISSOR_TEST)` + `gl.scissor(...)`, draw twice with per-side uniforms.
- **UI:** a draggable vertical divider overlaid on the viewport (ICAT-style) updating `split` (0..1);
  a menu to enable compare and pick left/right modes.
- **Out of scope:** WebGL-vs-WebGPU compare (one canvas = one context) — would need dual canvases.
  `effect-on/off` modes land after Phase 4.
- **Files:** `webgpu-scene.js` + `mesh-renderer.js`, `scene.js`, both facades, `App.jsx`, `styles.css`.

## Phase 4 — Post-processing effects SDK + example effects (blur, DoF)

*Largest phase. Refactors both scene cores to render offscreen, then run an effect chain.*

- **Offscreen refactor:**
  - WebGPU: scene renders the mesh/splat pass into an offscreen color target (+ depth for DoF)
    instead of the swapchain; a `PostProcessStack` composites through the chain to the swapchain.
  - WebGL: FBO ping-pong (two framebuffers+textures) + a shared full-screen-quad vertex shader.
- **Author SDK contract:** an effect = one shader-pass file per backend under `assets/effects/`
  (`*.effect.wgsl` and `*.effect.glsl`). Params are declared in a parsed header pragma, e.g.
  `//! param intensity float 1.0 0.0 2.0`, so authors add an effect purely by writing a shader file —
  no separate JS registration. The framework parses the header, builds the uniform buffer, and
  exposes sliders. Inputs available to a pass: previous color texture, original depth, resolution,
  time, params. Ship examples: `identity` (template), `blur` (separable Gaussian), `dof`.
- **UI:** an **Effects** panel — enable/disable the stack, list/reorder active effects, per-param
  sliders (from the parsed header). Effect files appear in Explorer under an **Effects** group,
  editable + applyable like shaders (reuses Phase 1's `effect` role).
- **Files:** `webgpu-scene.js` + new `renderers/post-process.js`, `scene.js` (FBO path), new
  `assets/effects/*`, new `scripts/engine/effect-parser.js`, both facades, `App.jsx`, `styles.css`.
  Add a Vite glob for `assets/effects/`.

## Phase 5 — Multi-texture materials for complex shaders

*Builds on Phase 2 upload + Phase 4 texture-binding conventions.*

- **Engine:** expand the mesh material to N named texture slots (albedo, normal, roughness, extra —
  4 slots). WebGPU: grow the `MeshRenderer` bind group + WGSL default shader bindings, add per-slot
  `hasTexture` flags to the material uniform. WebGL: add `uSampler0..N` + per-unit `activeTexture`
  binds and extend `buildProgramInfo`.
- **UI:** a **Material** panel to assign an uploaded image to each named slot.
- **Files:** `mesh-renderer.js` + `assets/shaders/default.wgsl`, `webgl-helpers.js` /
  `webgl-facade.js` + `assets/shaders/default.frag`, both facades
  (`setObjectTexture(slot, bitmap)`), `App.jsx`.

---

## Verification (per phase)

Run `cd ui && npm run dev` and exercise each phase in the browser on **both** backends
(Settings ▸ Renderer):

- **P0:** overlay shows plausible FPS + correct triangle/splat counts; no per-frame React re-render.
- **P1:** edit default.wgsl, Save As to disk, reload, Open File it back, Apply → change renders.
  Cmd+S writes back to the same file silently.
- **P2:** Load Texture on a cube/sphere → image appears, both backends.
- **P3:** enable compare, drag the divider → left/right show the selected modes.
- **P4:** enable blur then DoF; edit `blur.effect.*`, Apply → live recompile; sliders work; both backends.
- **P5:** assign different images to albedo/normal slots → a custom shader samples both.

Add Jest tests for pure logic introduced (effect-header parser, stats math, compare-split math)
alongside the existing `__tests__/` suites; run `npm test` from the repo root.

## Notes / risks

- **WebGL post-processing (Phase 4) is the highest-risk item:** WebGL 1.0 FBO + float-depth
  limitations mean DoF may need a packed-depth workaround; scope DoF quality accordingly there.
- `scene.js` (WebGL) should be de-noised of legacy `console.log`/`console.trace` calls as it is
  refactored across P0/P3/P4.
- Keep all executed user code flowing through `compileUserScript`; loaded external engine `.js`
  stays view/edit-only.
