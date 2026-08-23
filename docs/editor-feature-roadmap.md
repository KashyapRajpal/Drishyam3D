# Drishyam3D Feature Roadmap

Comprehensive architecture and delivery roadmap for **Drishyam3D** — tracking completed milestones, active work, and forward-looking capabilities across engine rendering, UI workspaces, and developer tooling.

---

## Milestone Status Overview

| Phase | Milestone / Capability | Status | Highlights |
| :--- | :--- | :---: | :--- |
| **Phase 0** | **Stats & Diagnostics Overlay** | ✅ Completed | Real-time EMA FPS, frame times, triangle/splat counts, backend indicators. |
| **Phase 1** | **Local File System Access API** | ✅ Completed | Native `Cmd+O` / `Cmd+S` disk save/load for WGSL/GLSL shaders and JS scene scripts. |
| **Phase 2** | **Texture & Logo Mapping** | ✅ Completed | Drishyam3D logo mapping across 3D primitives; single-texture upload support. |
| **Phase 3** | **Ray Tracing & Hybrid Shadows** | ✅ Completed | CPU/GPU Progressive Path Tracing (Cornell Box) + Real-time Hybrid Ray-Traced Shadows. |
| **Phase 3a**| **3D Gaussian Splatting (3DGS)** | ✅ Completed | Neural `.ply` ingestion, WebGPU on-GPU bitonic depth sorting, alpha blending. |
| **Phase 3b**| **Split-Screen Compare Slider** | ✅ Completed | Interactive wipe divider overlay (`CompareSlider.jsx`) for before/after comparison. |
| **Phase 3c**| **UI Modernization & Dual Modes** | ✅ Completed | Minimal View Mode (floating glass HUD) + Studio Edit Mode (tabbed CodeMirror IDE). |
| **Phase 3d**| **Automated Doc & Screenshot System**| ✅ Completed | Headless WebGPU Playwright screenshot runner & automated README sync (`npm run docs:screenshots`). |
| **Phase 6a**| **Textured & Colored PLY Mesh Loader**| ✅ Completed | Header inspection for 3DGS vs mesh, Artec UV indexing, uint32 index buffer support. |
| **Phase 4** | **Post-Processing Effects SDK** | ⏳ Next Up | Offscreen FBO pipeline, shader-pass authoring, Gaussian Blur & Depth of Field (DoF). |
| **Phase 5** | **Multi-Texture PBR Materials** | 📅 Planned | Albedo, Normal, Roughness, Metallic texture slots with PBR WGSL/GLSL shaders. |
| **Phase 6b**| **Binary glTF (.glb) & Niantic .spz** | 📅 Planned | In-memory 12-byte chunk reader for `.glb` and gzip decompression for `.spz` neural splats. |
| **Phase 7** | **Camera Orbit Animation & 4K Recording**| 📅 Planned | Spline-based camera paths and high-res WebM canvas export. |

---

## Completed Highlights

### 1. Dual Workspace Architecture (Minimal View + Studio Edit)
- **Minimal View Mode**: Uncluttered full-viewport viewing with floating dark-glass control bar, backend selector, render mode pill, and collapsible Quick Guide HUD.
- **Studio Edit Mode**: Full 3-panel IDE with categorized top menu (**File**, **Examples**, **Shapes**, **Render Engine**, **View**, **Help**), file explorer, and tabbed CodeMirror editor.
- **Persistent Viewport**: Canvas is never destroyed when switching modes, preserving WebGPU contexts and animation loops.

### 2. Hardware Ray Tracing & Progressive Path Tracing
- **Progressive Global Illumination**: Multi-bounce diffuse path tracing with real-time SPP accumulation and live pause/resume controls.
- **Hybrid Real-Time Shadows**: WebGPU G-buffer rasterization coupled with compute-traced hard shadow rays for retained glTF models.
- **Acceleration Structures**: Built-in BLAS and TLAS builders with SAH/BVH acceleration.

### 3. Neural 3D Gaussian Splatting
- **GPU Compute Bitonic Sort**: Parallel per-frame depth sorting on WebGPU compute shaders.
- **Spherical Harmonics**: View-dependent color representation (degrees 0–3) with premultiplied alpha blending.

### 4. Automated Screenshot & Docs Synchronizer
- **Declarative Scenarios**: `visual/readme-scenarios.mjs` defines test recipes across all features.
- **Automated Capture**: `npm run docs:screenshots` drives Chrome with WebGPU flags to generate 2x retina images and sync `README.md`.

---

## Upcoming Phases

### Phase 4 — Post-Processing Effects SDK (Next Up)
- **Offscreen Target Pipeline**: Render scene to offscreen color and depth textures.
- **Authorable Shader Passes**: Author new effect passes with auto-parsed parameter pragmas (e.g. `//! param intensity float 1.0 0.0 2.0`).
- **Initial Effects**: Separable Gaussian Blur and Depth of Field (DoF).
- **Effects Control Panel**: Reorderable stack with real-time uniform sliders.

### Phase 5 — Multi-Texture PBR Materials
- **Expanded Texture Slots**: 4 distinct material channels (Albedo, Normal, Roughness, ORM).
- **PBR Pipeline**: Physically-based rendering in WGSL and GLSL with environment map support.

### Phase 6b — Expanded Neural & Mesh Containers
- **Binary glTF (`.glb`)**: Chunk parser for single-file models with embedded textures.
- **Niantic `.spz`**: Compressed Gaussian splat decompression via `DecompressionStream('gzip')`.

### Phase 7 — Cinematic Camera & Recording
- **Keyframe Orbit Paths**: Smooth Bézier/spline camera fly-through sequences.
- **Direct Canvas Video Export**: Real-time 60fps / 4K WebM recording via `MediaRecorder` API.
