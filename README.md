# Drishyam3D - A Modern WebGPU Scene Editor

[![Status: Beta](https://img.shields.io/badge/status-beta-blue.svg)](https://github.com/kashyaprajpal/Drishyam3D)

[**Try the Live Demo!**](https://kashyaprajpal.github.io/Drishyam3D/)

Drishyam3D is a lightweight, browser-based 3D scene editor built with **WebGPU** and **React**. It supports both traditional triangle-based rendering (meshes, glTF models) and cutting-edge **3D Gaussian Splatting** for neural rendering workflows. The editor provides a powerful interface for writing and testing shaders, scene scripts, and loading rendered scenes in real-time.

## Features

*   **Dual Rendering Backends**: Choose between **WebGL** or **WebGPU** in Settings for high-performance rendering with modern GPU capabilities.
*   **CPU and GPU Path Tracing**: Render the procedural Cornell Box or retained glTF geometry progressively, with live SPP, bounce, sampling, pause, and reset controls.
*   **Hybrid Ray-Traced Shadows**: Keep WebGPU raster primary visibility while tracing real-time hard shadows for glTF objects, with directional/point light controls and BLAS/TLAS timing stats.
*   **Triangle-Based Rendering**: Render meshes, glTF models, and procedural shapes with full shader control.
*   **3D Gaussian Splatting**: Load and render `.ply` scenes captured with neural rendering techniques. Includes GPU-accelerated bitonic depth sorting and optional debug visualization modes.
*   **Flexible Model Import**: Import GLTF models from local files (including `.zip` archives or entire directories) or load a sample model directly from the web.
*   **Custom GLTF Parser**: A built-in, simplified GLTF 2.0 parser handles common model structures.
*   **Dual-Panel Code Editor**:
    *   Edit **Shaders** (GLSL for WebGL, WGSL for WebGPU) to control the appearance of objects.
    *   Write **Scene Scripts** (JavaScript) to define object behavior and animations.
*   **Real-time Reload**: Instantly apply your shader and script changes with the **Apply** button.
*   **Error Console**: Displays compilation and runtime errors from your code to help with debugging.
*   **Clean, Resizable UI**: A modern React-based layout with tabbed editors and responsive panels.
*   **Planned Chronograph Material Fidelity (post-MVP)**: Transmission, normal and ORM maps, material variants, texture transforms, and glTF animation are a separate follow-up feature rather than part of the ray-tracing MVP.

## Screenshots & Demo

<!-- AUTO_SCREENSHOT_GALLERY:START -->
<div align="center">

| Workspace / Mode | Feature Description |
| :--- | :--- |
| **Minimal View Mode**<br><br><img src="assets/screenshots/minimal-view-mode.png" width="420" alt="Minimal View Mode"/> | Clean, distraction-free 3D canvas viewport with floating glass control pill and live performance stats. |
| **Studio Edit Workspace**<br><br><img src="assets/screenshots/studio-edit-mode.png" width="420" alt="Studio Edit Workspace"/> | Comprehensive 3-panel layout: interactive File Explorer on the left, real-time 3D Viewport in the center, and live Code Editor with syntax highlighting on the right. |
| **Cornell Box GPU Path Tracing**<br><br><img src="assets/screenshots/cornell-box-raytrace.png" width="420" alt="Cornell Box GPU Path Tracing"/> | Progressive Monte Carlo path tracing with soft area lighting, color bleeding, and progressive SPP accumulation. |
| **glTF Rasterization + Ray-Traced Soft Shadows**<br><br><img src="assets/screenshots/hybrid-shadows-gltf.png" width="420" alt="glTF Rasterization + Ray-Traced Soft Shadows"/> | G-Buffer deferred rasterization combined with GPU compute ray-traced shadow occlusion rays. |
| **3D Gaussian Splatting**<br><br><img src="assets/screenshots/drishyam-splat-render.png" width="420" alt="3D Gaussian Splatting"/> | Real-time neural point-cloud rendering with GPU radix depth sorting and spherical harmonics. |
| **Universal Command Palette**<br><br><img src="assets/screenshots/command-palette.png" width="420" alt="Universal Command Palette"/> | Quick-access command launcher (⌘K / Ctrl+K) for switching layouts, loading assets, toggling render backends, and debugging. |

</div>
<!-- AUTO_SCREENSHOT_GALLERY:END -->

For a live demo, visit: [**https://kashyaprajpal.github.io/Drishyam3D/**](https://kashyaprajpal.github.io/Drishyam3D/)

## How to Run

### Prerequisites

- **Node.js and npm**: This project requires a recent version of Node.js and the `npm` package manager. You can download them from the [official Node.js website](https://nodejs.org/).

### Steps to run:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/KashyapRajpal/Drishyam3D.git
    cd Drishyam3D
    ```

2.  **Navigate to the UI directory**:
    The user interface is a React application located in the `ui` directory.
    ```bash
    cd ui
    ```

3.  **Install dependencies**:
    ```bash
    npm install
    ```

4.  **Run the development server**:
    ```bash
    npm run dev
    ```

5.  **Open your web browser** and navigate to the URL provided by Vite (usually `http://localhost:5173`).

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds the React UI in `ui` and publishes `ui/dist` to GitHub Pages.

1.  **Set the correct base path** in [ui/vite.config.js](ui/vite.config.js) to match your repo name.
    *   Example: `/Drishyam3D/`
2.  **Push to `main`** (or run the workflow manually from the Actions tab).
3.  **Enable Pages**: In GitHub → Settings → Pages, set **Source** to **GitHub Actions**.

After the workflow completes, the app will be available at the Pages URL for the repository.

## Editor Guide

The editor is divided into three main panels and a top menu bar.

### Panels

*   **Explorer Panel (Left)**: This panel displays the file structure of the project, including your scene script, shaders, and the engine's source code. Double-click any file to open it in the editor panel.
*   **Viewport (Center)**: This is where your 3D scene is rendered. It will update in real-time based on your script and shader modifications.
*   **Editor Panel (Right)**: A tabbed interface for editing code.
    *   **Tabs**: Open files appear as tabs at the top. You can switch between them or close them.
    *   **Code Editor**: A full-featured editor for GLSL (shaders) and JavaScript.
    *   **Footer**: Contains **Apply** and **Reset** buttons, an **Auto Refresh** checkbox, and an error console.

## Workspace & Workflows

### 1. Minimal View Mode
- **Navigation & Inspection**: Orbit, pan, and zoom across 3D scenes without UI distraction.
- **Floating HUD**: Quick toggle for render backends (WebGPU / WebGL), render mode selector (Raster, CPU Path Tracing, GPU Path Tracing, Hybrid Shadows), and performance stats.
- **Interactive Legend**: Bottom-left badge with quick camera shortcuts and engine guides.

### 2. Studio Edit Mode
- **Top Menu Bar**:
  - **File**: `Open Local File…` (`⌘O`), `Save File` (`⌘S`), `Load Sample glTF`, `Load Asset Folder…`, `Reset Scene`.
  - **Examples**: `🏛️ Cornell Box (CPU Path Tracing)`, `⚡ Cornell Box (GPU Path Tracing)`, `📦 Sample glTF (Ray-Traced Shadows)`.
  - **Shapes**: `Cube`, `Sphere`, and `Textured` (with Drishyam3D logo).
  - **Render Engine**: `⚡ WebGPU` and `🌐 WebGL`.
  - **View**: Toggle File Explorer, Tabbed Code Editor, Real-time Stats Overlay, and Fullscreen.
- **Tabbed CodeMirror Editor**:
  - Live editing of WGSL and GLSL shaders (`default.wgsl`, `default.vert`, `default.frag`) and JavaScript scene scripts (`scene-script.js`).
  - `⌘↵` / `Ctrl+↵` to instantly compile and apply changes live.

---

## Roadmap & Milestones

See [**`docs/editor-feature-roadmap.md`**](docs/editor-feature-roadmap.md) for detailed technical specifications.

| Milestone | Capability | Status |
| :--- | :--- | :---: |
| **Phase 0** | **Stats & Diagnostics Overlay** | ✅ Completed |
| **Phase 1** | **Local File System Access API** (`⌘O`, `⌘S`) | ✅ Completed |
| **Phase 2** | **Texture & Logo Mapping** | ✅ Completed |
| **Phase 3a** | **3D Gaussian Splatting** (GPU Bitonic Depth Sorting & Alpha Blending) | ✅ Completed |
| **Phase 3b** | **Hardware Ray Tracing & Hybrid Shadows** (GPU/CPU Path Tracing + Deferred Ray Occlusion) | ✅ Completed |
| **Phase 3c** | **UI Modernization & Command Palette** (`⌘K`, Minimal View + Studio Edit) | ✅ Completed |
| **Phase 3d** | **Automated High-DPI Screenshot & README Sync Pipeline** | ✅ Completed |
| **Phase 6a** | **Textured & Colored PLY Mesh Loader** | ✅ Completed |
| **Phase 4** | **Post-Processing Effects SDK** (Offscreen FBOs, Blur, Depth of Field) | ⏳ Next Up |
| **Phase 5** | **Multi-Texture PBR Materials & Dual-Pass Scissor** | 📅 Planned |
| **Phase 6b** | **Expanded Neural Containers** (Niantic `.spz`, Binary glTF `.glb`) | 📅 Planned |
| **Phase 7** | **Cinematic Camera Orbit & 4K WebM Canvas Recording** | 📅 Planned |

---

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

### Adding Features & Visuals
When implementing a new visual feature or shader pass, add a scenario recipe to `visual/readme-scenarios.mjs` and run:
```bash
npm run docs:screenshots
```
This will automatically capture 2x retina screenshots and update the README gallery.

---

## License

This project is licensed under the [MIT License](LICENSE).
