# Drishyam3D - A Simple WebGL Scene Editor

[![Status: Beta](https://img.shields.io/badge/status-beta-blue.svg)](https://github.com/kashyaprajpal/Drishyam3D)

[**Try the Live Demo!**](https://kashyaprajpal.github.io/Drishyam3D/)

Drishyam3D is a lightweight, browser-based 3D scene editor built with WebGL. The UI is a React app (layout unchanged from the earlier HTML version) and provides a simple interface for writing and testing fragment shaders and scene manipulation scripts in real-time.

## Features

*   **Live WebGL Viewport**: Renders a 3D scene directly in your browser.
*   **Flexible Model Import**: Import GLTF models from local files (including `.zip` archives or entire directories) or load a sample model directly from the web.
*   **Custom GLTF Parser**: A built-in, simplified GLTF 2.0 parser handles common model structures.
*   **Dual-Panel Code Editor**:
    *   Edit **Fragment Shaders** (GLSL) to control the appearance of objects.
    *   Write **Scene Scripts** (JavaScript) to define object behavior and animations.
*   **Real-time Reload**: Instantly apply your shader and script changes with the **Apply** button.
*   **Error Console**: Displays compilation and runtime errors from your code to help with debugging.
*   **Basic UI**: A clean, resizable layout with tabbed editors for a smooth workflow.

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
    *   `Import .zip`: Loads a `.zip` containing a `.gltf` and its assets (`.bin`, textures).
    *   `Import Directory`: Opens a directory picker to load a GLTF model from a folder.
    *   `Load Sample Model`: Loads a textured cube GLTF model from the web for quick testing.
    *   `Reset Scene`: Resets the viewport to the default cube and reloads the original scene script.
*   **Shapes Menu**:
    *   `Textured` (Checkbox): When checked, any shape loaded from this menu will use the default checkerboard texture. This setting updates the current shape in real-time.
    *   `Cube` / `Sphere`: Loads a primitive cube or sphere into the scene.

### Basic Workflow

1.  **Load a Model**: Use **File > Load Sample Model**, **File > Import .zip**, or **Shapes > Sphere** to get an object in the scene.
2.  **Animate the Model**:
    *   In the Explorer, double-click `scene-script.js`.
    *   Modify the `update` function to change the model's rotation, position, or scale. For example, change `state.modelRotation += deltaTime * 0.5;` to `state.modelRotation += deltaTime * 2.0;` to make it spin faster.
3.  **Change its Appearance**:
    *   In the Explorer, double-click `default.frag` under the "Shaders" folder.
    *   Modify the GLSL code. For example, to make untextured objects red, change the `else` block to `gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);`.
4.  **See Your Changes**:
    *   Click the **Apply** button in the editor footer.
    *   Alternatively, check **Auto Refresh** and changes will apply automatically about 3 seconds after you stop typing.

## Roadmap

The goal of Drishyam3D is to evolve into a forward-looking platform for modern, high-performance web graphics. Development is organized into three focused phases: a foundational UI/UX overhaul, migration of the rendering core to WebGPU, and the addition of advanced rendering capabilities such as neural rendering and hardware-accelerated ray tracing.

### Phase 1: Foundational UI/UX Overhaul (Completed)

The UI has been migrated from the original vanilla JavaScript front-end to a React-based app while keeping the overall layout and workflow the same.

### Phase 2: Next-Generation Rendering Engine

The core rendering engine will be migrated from WebGL to **WebGPU**. This is a foundational step to unlock significant performance improvements and modern GPU capabilities. Key benefits include:
*   **High-Performance Rendering**: Lower CPU overhead for more complex scenes.
*   **Compute Shaders**: Native support for general-purpose GPU (GPGPU) workloads, enabling high-performance simulations and parallel data processing directly on the GPU.

### Phase 3: Advanced Rendering Capabilities

Building on the new WebGPU engine, we will implement support for cutting-edge rendering techniques. The goals for this phase include:

*   **Neural Rendering (Gaussian Splatting)**: Implement a renderer for 3D Gaussian Splatting, enabling the loading and real-time display of scenes captured with neural rendering methods.
*   **Hardware-Accelerated Ray Tracing**: Integrate support for real-time ray tracing for photorealistic lighting, shadows, and reflections. (Note: This relies on an experimental WebGPU extension and is a forward-looking goal).



## Contributing

Contributions are welcome! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating. If you have a feature request, bug report, or want to contribute code, please feel free to open an issue or submit a pull request.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.