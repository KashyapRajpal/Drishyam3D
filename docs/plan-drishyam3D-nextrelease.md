## Plan: Drishyam3D Next Major Release

Deliver a technical-artist-focused major release over a quarter by prioritizing practical scene authoring workflows (materials, shader presets, save/load), reaching WebGPU parity for core assets (cube, sphere, glTF), and shipping a basic Gaussian splat viewer. Keep neural rendering out of scope for this release except for architecture placeholders.

## Refinement Pass: WebGPU Implementation Scrutiny (April 2026)

This refinement is based on the current code, not assumptions from the roadmap. It updates priorities for the next major release.

**Current status snapshot**
1. WebGPU backend is wired through engine dispatch and can render primitives via WGSL.
2. Renderer switching is functional in the UI.
3. Core parity is incomplete for imported models and several editor workflows.

**Findings (ordered by severity)**
1. Critical: glTF import path is WebGL-only and breaks WebGPU parity goals.
	- [scripts/engine/scene-ops.js](../scripts/engine/scene-ops.js#L38)
	- [scripts/engine/scene-ops.js](../scripts/engine/scene-ops.js#L83)
	- [scripts/engine/scene-ops.js](../scripts/engine/scene-ops.js#L115)
	- [scripts/engine/gltf-parser.js](../scripts/engine/gltf-parser.js#L123)
2. High: WebGPU scene stores drawable in a module-global variable, which risks cross-instance state bleed.
	- [scripts/engine/webgpu-scene.js](../scripts/engine/webgpu-scene.js#L19)
3. High: WebGPU resource lifecycle is incomplete; scene destroy does not release owned GPU resources.
	- [scripts/engine/webgpu-scene.js](../scripts/engine/webgpu-scene.js#L223)
4. Medium: Auto-refresh excludes WGSL edits, so shader live-edit behavior is inconsistent between backends.
	- [ui/src/App.jsx](../ui/src/App.jsx#L555)
	- [ui/src/App.jsx](../ui/src/App.jsx#L556)
5. Medium: Reset action does not include WGSL tab, creating inconsistent editor reset behavior in WebGPU mode.
	- [ui/src/App.jsx](../ui/src/App.jsx#L545)
6. Medium: Texture loading helper does not validate HTTP failure before decoding image data.
	- [scripts/engine/webgpu-helpers.js](../scripts/engine/webgpu-helpers.js#L179)
7. Medium: No WebGPU-focused automated tests currently exist, increasing regression risk.
	- [__tests__/scene.test.js](../__tests__/scene.test.js)
	- [__tests__/webgl-helpers.test.js](../__tests__/webgl-helpers.test.js)

**Immediate implementation updates (pre-feature work)**
1. Replace module-global drawable state with scene-local state in WebGPU scene implementation.
2. Add deterministic cleanup in WebGPU scene destroy path for depth texture and owned drawables/resources.
3. Introduce backend-aware glTF conversion pipeline:
	- Phase A: parse into backend-agnostic mesh/material payload.
	- Phase B: upload payload via WebGL or WebGPU buffer builders.
4. Enable WGSL in auto-refresh and reset flows to keep editor behavior consistent.
5. Harden WebGPU texture loading with fetch status checks and actionable error messages.
6. Add initial WebGPU test coverage:
	- facade initialization success/failure paths,
	- scene render loop smoke test with mocked GPU device,
	- shader apply/update behavior,
	- backend switching regression tests in UI integration layer.

**Steps**

**Phase 1 - Product Baseline and Contracts**
1. Define release contracts and data schemas: scene JSON v1, shader preset format, material schema, and WebGPU feature flags (includes splat-viewer capability flag). Output a short RFC in docs and align API signatures in app facade. This blocks all later implementation work.
2. Complete WebGPU stability baseline before feature expansion: remove module-global drawable state, add proper resource cleanup, and ensure WGSL auto-refresh/reset parity in the editor. Depends on step 1.
3. Refactor core scene state from single drawable assumptions to object list + per-object material references while preserving backward compatibility for existing single-object flows. Depends on step 2.
4. Split App-level orchestration in ui/src/App.jsx into feature slices (scene list/inspector, shader panel, renderer controls) to reduce risk for concurrent work. Parallel with step 3 after schema lock.

**Phase 2 - Technical Artist Workflow Features**
5. Implement per-object material inspector: base color, texture map binding, basic surface controls (roughness/metallic placeholders where backend supports). Depends on step 3.
6. Implement shader preset library and custom shader save/load: preset picker, user-defined presets, validation, import/export. Parallel with step 5; both depend on step 1 and UI slice from step 4.
7. Implement scene save/load JSON (export/import + local persistence) including object transforms, material links, active shader preset, and camera state. Depends on step 3 and step 5.
8. Add lightweight scene creation helpers: add object, duplicate/delete, transform manipulation panel, reset selection. Parallel with step 7 after step 3.

**Phase 3 - WebGPU Parity and Performance Track**
9. Complete backend-agnostic glTF parsing and WebGPU upload path for imported models; then close parity for cube+sphere+glTF including robust fallback behavior when WebGPU is unavailable. Depends on step 2 and step 3.
10. Implement instanced rendering path in WebGPU for repeated objects and add runtime toggle/metrics logging to compare non-instanced path. Depends on step 9.
11. Add WebGPU parity tests and fixture coverage for geometry + glTF render path. Parallel with step 10 after parity pipeline is stable.

**Phase 4 - Basic Gaussian Splat Viewer (Shippable, constrained)**
12. Implement splat asset ingestion and rendering-only pipeline (no editing): load splat data format, camera navigation, point size/opacity controls, render stats panel. Depends on step 9.
13. Integrate splat viewer into scene workflow as a separate object type with clear unsupported operations messaging (e.g., no mesh editing). Depends on step 12 and step 7.
14. Add safety/perf constraints: max splat count guardrails, memory budget checks, graceful degradation. Depends on step 12.

**Phase 5 - Stabilization and Release**
15. Expand automated tests: scene serialization roundtrip, shader preset persistence, material binding, WebGPU parity smoke tests, splat viewer loading and fallback paths. Depends on steps 5-14.
16. Add manual QA matrix for macOS/WebGPU adapters, imported glTF variants, texture/shader save-load roundtrips, and large-splat performance scenarios. Parallel with step 15.
17. Final release hardening: migration notes, docs refresh, versioned scene format notes, and deprecations list for future neural-rendering track. Depends on steps 15-16.

**Relevant files**
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/scene.js - migrate from single drawable assumptions to multi-object state and per-object materials.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/app-facade.js - define stable APIs for scene manipulation, serialization, and backend switching.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/scene-ops.js - extend add/duplicate/delete/reset operations and import/export hooks.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/gltf-parser.js - ensure imported glTF path maps to parity material/object contracts.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/webgpu-facade.js - parity wiring and feature gates for WebGPU workflows.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/webgpu-scene.js - instancing and splat rendering integration.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/scripts/engine/webgpu-helpers.js - buffer layouts, resource binding updates, and GPU guardrails.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/assets/shaders/default.wgsl - parity shading path and extensibility points for material controls.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/ui/src/App.jsx - feature-sliced UI orchestration for inspector/shader/persistence/backend controls.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/__tests__/scene.test.js - expand for multi-object behavior and serialization interactions.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/__tests__/webgl-helpers.test.js - baseline references for rendering helper correctness.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/__tests__/geometry.test.js - fixture extensions for parity geometry workflows.
- /Users/kashyaprajpal/Desktop/Personal Projects/Drishyam3D/docs/webgpu-migration-plan.md - update with parity completion criteria and splat viewer milestones.

**Verification**
1. Automated: run Jest suites and add new integration tests for serialization roundtrip and WebGPU parity smoke paths.
2. Automated: validate scene JSON schema and shader preset schema using deterministic fixtures and backwards compatibility fixtures.
3. Manual: create a 5-object scene with mixed materials/textures, save/load twice, verify object/material identity stability.
4. Manual: switch renderer WebGL <-> WebGPU on same scene and verify geometry/material parity with tolerances documented.
5. Manual: load representative glTF samples (textured and untextured), then save/reload scene and verify fidelity.
6. Manual: open splat dataset at small, medium, large sizes and verify frame stability, memory guardrails, and fallback behavior.
7. Release gate: all critical regressions blocked unless triaged with explicit defer labels and owner.
8. Regression gate: WebGPU shader editing parity validated (Apply, Auto Refresh, Reset) for WGSL path.
9. Regression gate: imported glTF flows (zip, folder, sample URL) work in both backends.

**Decisions**
- Audience priority: technical artists.
- Time horizon: quarter-scale major release.
- Must-have scope: per-object textures/material inspector, shader preset library with save/load, WebGPU parity for cube+sphere+glTF, instanced rendering pass, basic Gaussian splat viewing.
- Included geometry editing scope: transform-level object editing (add/move/duplicate/delete) only.
- Excluded from this release: advanced mesh/vertex editing, full neural rendering/inference pipeline.

**Milestones and Deliverables**
1. Milestone 1 (Weeks 1-3): Contracts approved, multi-object state baseline merged, UI split ready for parallel work.
2. Milestone 2 (Weeks 4-6): Material inspector + shader preset system functional, scene save/load v1 usable in daily workflows.
3. Milestone 3 (Weeks 7-9): WebGPU parity complete for cube/sphere/glTF, initial instancing path integrated.
4. Milestone 4 (Weeks 10-11): Gaussian splat viewer beta (load + view + controls + guardrails).
5. Milestone 5 (Weeks 12-13): Stabilization, regression burn-down, release docs and migration notes complete.

**Acceptance Criteria**
1. Users can create and manage multi-object scenes without losing backward compatibility with existing single-object use.
2. Users can save and reload scenes with stable object IDs, transforms, material assignments, and camera state.
3. Shader presets are portable via import/export and custom shaders can be persisted and restored.
4. WebGPU can render cube, sphere, and representative glTF models with documented parity tolerance versus WebGL.
5. Splat viewer can load supported datasets with predictable controls and stable fallback on unsupported hardware.

**Stretch Goals (Post Release)**
1. Advanced geometry editing: vertex/edge/face selection, simple extrude/inset, and topology-safe operations.
2. Material graph editor: node-based shader authoring with compile-to-GLSL/WGSL pipeline.
3. Hybrid render features: screen-space reflections, shadow maps, and temporal anti-aliasing in WebGPU path.
4. Splat tooling: on-the-fly level-of-detail generation, splat painting/tagging, and scene integration with mesh occluders.
5. Neural rendering track (research-to-product): pre-baked neural assets first, then evaluate real-time inference when WebGPU ML tooling matures.
6. Collaboration and versioning: scene diff/merge helpers, project templates, and shared preset repositories.
7. Asset pipeline upgrades: texture compression/transcoding support and background asset processing queue.

**Further Considerations**
1. Splat format choice: Option A PLY-derived loader with conversion; Option B native compact binary format. Recommendation: start with Option A + converter tool for faster adoption.
2. Scene format evolution: Option A strict semver schema; Option B loose additive schema. Recommendation: semver schema with migration adapters.
3. UI architecture: Option A keep single App.jsx with internal modules; Option B split into components now. Recommendation: split now to reduce quarter-scale merge risk.