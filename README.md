# Drishyam3D - A Modern WebGPU Scene Editor

[![Status: Beta](https://img.shields.io/badge/status-beta-blue.svg)](https://github.com/kashyaprajpal/Drishyam3D)

[**Try the Live Demo!**](https://kashyaprajpal.github.io/Drishyam3D/)

Drishyam3D is a lightweight, browser-based 3D scene editor built with **WebGPU** and **React**. It supports both traditional triangle-based rendering (meshes, glTF models) and cutting-edge **3D Gaussian Splatting** for neural rendering workflows. The editor provides a powerful interface for writing and testing shaders, scene scripts, and loading rendered scenes in real-time.

## Features

*   **Dual Rendering Backends**: Choose between **WebGL** or **WebGPU** in Settings for high-performance rendering with modern GPU capabilities.
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

## Screenshots & Demo

### Editor Interface
The Drishyam3D editor provides a professional three-panel layout for interactive 3D development:

![Drishyam3D Editor with glTF Model](drishyam-editor-clean.png)

**Key Features Visible:**
- **Left Panel**: Explorer showing project files, shaders (WGSL for WebGPU), and engine modules
- **Center Panel**: Real-time 3D viewport with WebGPU rendering showing a textured glTF model
- **Right Panel**: Code editor with syntax highlighting for scene scripts and shaders
- **Auto-reload**: Real-time updates as you edit code

### 3D Gaussian Splatting Rendering
Drishyam3D supports modern neural rendering techniques. Load and render 3D Gaussian Splat scenes (.ply format) with GPU-accelerated depth sorting:

![Drishyam3D Gaussian Splat Rendering](drishyam-splat-render.png)

The tree above was captured using 3D Gaussian Splatting and is rendered in real-time with:
- **Per-frame depth sorting** via WebGPU compute shaders
- **Premultiplied alpha blending** for correct transparency
- **Interactive camera control** for 360° viewing
- **Debug visualization modes** (Points, Points-Sorted) for validation

### Capabilities
- **Dual Rendering**: Switch between WebGL (legacy) and WebGPU (modern) backends in Settings
- **Model Import**: Load glTF models, 3D Gaussian Splats (.ply), and procedural shapes
- **Shader Editing**: Write custom WGSL (WebGPU) or GLSL (WebGL) shaders with real-time feedback
- **Scene Scripting**: Control objects, animations, and interactions with JavaScript
- **Neural Rendering**: Render 3D Gaussian Splatting scenes with GPU-accelerated depth sorting
- **Seamless Integration**: Mix traditional geometry and splats in the same scene

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

### Menu Bar

*   **File Menu**:
    *   `Load Chronograph Watch (CC BY 4.0)`: Loads the
        [Khronos Chronograph Watch](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChronographWatch)
        external-file glTF for a realistic multi-mesh sample and ray-traced-shadow stress case.
        The app switches to WebGPU automatically because the legacy WebGL path renders only one
        glTF primitive, while this asset contains 19.
        The model and textures are by Eric Chadwick / Darmstadt Graphics Group GmbH and are
        used under [CC BY 4.0 and the accompanying logo terms](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/ChronographWatch/LICENSE.md).
        Geometry, base-color textures, and hybrid shadows load today; transmission, material
        variants, texture transforms, glTF animation, and full normal/ORM PBR shading are not
        yet represented faithfully.
    *   `Load Asset…`: Opens a **folder picker** and loads the model inside it (see
        [Asset folder convention](#asset-folder-convention)). The format is detected automatically:
        a `.gltf` (with its `.bin`/textures) on either backend, or a `.ply` on **WebGPU** — which is
        further inferred as a Gaussian **splat** or a triangle **mesh** from its header.
    *   `Reset Scene`: Resets the viewport to the default cube and reloads the original scene script.

#### Asset folder convention

`Load Asset…` selects a **directory**, not a single file — browsers can't read a picked file's
sibling files, so a folder grant is what lets the companion assets (`.bin`, textures) load
automatically. Therefore **each asset lives in its own folder**, containing exactly one primary
model file (`.gltf`, `.glb`, or `.ply`) plus its dependencies (`.bin`, image textures).

Folder structure example:
```
my-model/
  my-model.gltf              (or .glb)
  my-model.bin
  textures/
    my-model_diffuse.jpg
    my-model_normal.png
```

Point `Load Asset…` at the folder and everything inside resolves automatically. The loader picks
the first `.gltf`/`.glb`/`.ply` it finds, so keep one primary model per folder.
*   **Shapes Menu**:
    *   `Textured` (Checkbox): When checked, any shape loaded from this menu will use the default checkerboard texture. This setting updates the current shape in real-time.
    *   `Cube` / `Sphere`: Loads a primitive cube or sphere into the scene.
*   **Settings Menu**:
    *   `Renderer`: Choose between **WebGL** or **WebGPU** backends.
    *   `Splat Debug` (when splat loaded): Cycle through debug modes — **Off** (full rendering), **Points** (splat centers), **Points (sorted)** (colored by depth order).

### Basic Workflows

#### Triangle-Based Rendering

1.  **Load a Model**: Use **File > Load Sample Model**, **File > Load Asset…** (pick a model folder), or **Shapes > Sphere** to get an object in the scene.
2.  **Animate the Model**:
    *   In the Explorer, double-click `scene-script.js`.
    *   Modify the `update` function to change the model's rotation, position, or scale. For example, change `state.modelRotation += deltaTime * 0.5;` to `state.modelRotation += deltaTime * 2.0;` to make it spin faster.
3.  **Change its Appearance**:
    *   In the Explorer, double-click `default.vert` or `default.frag` (WebGL) / `default.wgsl` (WebGPU) under the "Shaders" folder.
    *   Modify the shader code. For example, to make untextured objects red in GLSL, change the `else` block to `gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);`.
4.  **See Your Changes**:
    *   Click the **Apply** button in the editor footer.
    *   Alternatively, check **Auto Refresh** and changes will apply automatically about 3 seconds after you stop typing.

#### 3D Gaussian Splatting (WebGPU Only)

1.  **Switch to WebGPU**: Open Settings → **Renderer** → **WebGPU** (requires Chrome/Edge 113+).
2.  **Load a Splat Scene**: Use **File > Load Asset…** and pick a folder containing a 3DGS `.ply` capture (it's detected as a splat automatically).
3.  **Inspect Geometry** (Optional):
    *   Open Settings → **Splat Debug** and cycle through:
        *   **Points**: See raw splat centers (validates loading & projection).
        *   **Points (sorted)**: See centers colored by depth order (validates GPU sort).
        *   **Off**: Full Gaussian splatting rendering.
4.  **Orbit the Scene**: Use the mouse to rotate the camera and see the splats render from all angles with correct back-to-front blending.

## Roadmap

The goal of Drishyam3D is to evolve into a forward-looking platform for modern, high-performance web graphics. Development is organized into focused phases: a foundational UI/UX overhaul, migration of the rendering core to WebGPU, and the addition of advanced rendering capabilities such as neural rendering and hardware-accelerated ray tracing.

### Phase 1: Foundational UI/UX Overhaul (Completed)

The UI has been migrated from the original vanilla JavaScript front-end to a React-based app while keeping the overall layout and workflow the same.

### Phase 2: Next-Generation Rendering Engine (Completed)

The core rendering engine has been migrated from WebGL to **WebGPU** and now runs on both backends, selectable in Settings. This is a foundational step that unlocks significant performance improvements and modern GPU capabilities. Key achievements include:
*   **Dual Backend Support**: WebGL 1.0 (legacy) and WebGPU (modern) backends coexist. The public engine API is backend-agnostic.
*   **High-Performance Rendering**: Lower CPU overhead for complex scenes via WebGPU.
*   **Compute Shader Support**: Native WebGPU compute shaders enable high-performance GPGPU workloads, parallel data processing, and advanced algorithms like the bitonic sort for splat depth ordering.
*   **Backend-Agnostic Asset Loading**: glTF models load identically on both backends.

### Phase 3a: Neural Rendering (Completed)

**3D Gaussian Splatting** renderer is now live and production-ready:
*   **Load 3DGS Scenes**: Import `.ply` files captured with standard 3D Gaussian Splatting methods.
*   **GPU-Accelerated Depth Sort**: Bitonic sort implemented as a WebGPU compute pass, sorting splats back-to-front every frame without CPU bottleneck.
*   **Premultiplied Alpha Blending**: Correct view-dependent transparency rendering for Gaussian splats.
*   **Debug Visualization**: Optional debug modes (Points, Points-Sorted) for validating splat geometry and sort correctness.
*   **Seamless Integration**: Splats render alongside traditional geometry in the same scene using a polymorphic Renderer hierarchy.

### Phase 3b: Advanced Rendering (In Progress)

Planned enhancements to the Gaussian Splatting pipeline:
*   **Full Spherical Harmonics**: View-dependent color (degrees 1–3) for realistic relighting.
*   **GPU Radix Sort**: Faster sorting for very large splat counts (>10M).
*   **Compressed Formats**: `.splat` and other neural-rendering-native formats.

### Phase 3c: Ray Tracing (Forward-Looking)

Hardware-accelerated ray tracing for photorealistic lighting, shadows, and reflections — pending stable WebGPU ray-query support in browsers.



## Contributing

Contributions are welcome! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating. If you have a feature request, bug report, or want to contribute code, please feel free to open an issue or submit a pull request.

### Contribution Workflow

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

### For New Features: Include a Demo

To help reviewers and future users understand your feature, **please include visual documentation** in your pull request:

- **Screenshots**: Capture key states or results of your feature (use `npm run dev` to run the app and take screenshots)
- **Short Video**: Record a 10-30 second video showing the feature in action. Tools:
  - **macOS**: QuickTime Player (File → New Screen Recording) or ScreenFlow
  - **Windows**: Windows 10/11 Game Bar (Win+G) or OBS Studio
  - **Linux**: OBS Studio or SimpleScreenRecorder
  
  Export as **MP4** and add to your PR description or comments using GitHub's video upload.

- **GIF for Quick Demos**: Use tools like [ffmpeg](https://ffmpeg.org/) or [gifshot](https://yahoo.github.io/gifshot/) to create animated GIFs (especially useful for small interactions)

**Example PR Description:**
```markdown
## What's New
Added real-time shader error highlighting in the editor.

## Demo
[Attach video or GIF showing the error highlighting in action]

## Testing
- Load a shader with syntax errors
- Verify red underlines appear in the code
- Fix the error and confirm highlighting clears
```

This helps reviewers understand the context faster and makes it easier for new contributors to see what's possible with Drishyam3D!

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
