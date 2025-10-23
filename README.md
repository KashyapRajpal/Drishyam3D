# Drishyam3D - A Simple WebGL Scene Editor

Drishyam3D is a lightweight, browser-based 3D scene editor built with WebGL. It provides a simple interface for writing and testing fragment shaders and scene manipulation scripts in real-time.

## Features

*   **Live WebGL Viewport**: Renders a 3D scene directly in your browser.
*   **Flexible Model Import**: Import GLTF models from local files (including `.zip` archives or entire directories) or load a sample model directly from the web.
*   **Custom GLTF Parser**: A built-in, simplified GLTF 2.0 parser handles common model structures.
*   **Dual-Panel Code Editor**:
    *   Edit **Fragment Shaders** (GLSL) to control the appearance of objects.
    *   Write **Scene Scripts** (JavaScript) to define object behavior and animations.
*   **Real-time Reload**: Instantly apply your shader and script changes by clicking the "Run" button.
*   **Error Console**: Displays compilation and runtime errors from your code to help with debugging.
*   **Basic UI**: A clean, resizable layout with tabbed editors for a smooth workflow.

## How to Run

This project uses modern JavaScript modules (`import`/`export`), which have specific security requirements in web browsers. Therefore, **you must run it using a local web server.** Opening the `mainpage.html` file directly from your filesystem (`file:///...`) will not work.

**Why is a server required?**
Modern browsers enforce security features like Cross-Origin Resource Sharing (CORS) and restrict access to local file systems. When you use JavaScript modules or attempt to load local files (like GLTF assets), the browser blocks these operations if you open the HTML file directly from your local disk (`file:///`). A local server provides the necessary `http://` protocol, which gives your project a valid "origin" and allows modules to load and the File System Access API to function correctly.

**Steps to run:**
 
1.  Clone the repository.
2.  Open your terminal, navigate to the project's root directory, and start a simple web server. If you have Python 3, you can use:

    ```bash
    python -m http.server
    ```

3.  Open your web browser and navigate to: `http://localhost:8000/html/mainpage.html`

## Editor Guide

The editor is divided into three main panels and a top menu bar.

### Panels

*   **Explorer Panel (Left)**: This panel displays the file structure of the project, including your scene script, shaders, and the engine's source code. Double-click any file to open it in the editor panel.
*   **Viewport (Center)**: This is where your 3D scene is rendered. It will update in real-time based on your script and shader modifications.
*   **Editor Panel (Right)**: A tabbed interface for editing code.
    *   **Tabs**: Open files appear as tabs at the top. You can switch between them or close them.
    *   **Code Editor**: A full-featured editor for GLSL (shaders) and JavaScript.
    *   **Footer**: Contains the "Run" button to apply changes, an "Auto Refresh" checkbox, and an error console.

### Menu Bar

*   **File Menu**:
    *   `Import (.zip, .gltf)...`: Opens a directory picker to load a GLTF model. Select the root folder containing your `.gltf` file and all its assets (`.bin`, textures).
    *   `Load Sample Model`: Loads a textured cube GLTF model from the web for quick testing.
    *   `Reset Scene`: Resets the viewport to the default cube and reloads the original scene script.
*   **Shapes Menu**:
    *   `Textured` (Checkbox): When checked, any shape loaded from this menu will use the default checkerboard texture. This setting updates the current shape in real-time.
    *   `Cube` / `Sphere`: Loads a primitive cube or sphere into the scene.

### Basic Workflow

1.  **Load a Model**: Use the **File > Load Sample Model** or **Shapes > Sphere** to get an object in the scene.
2.  **Animate the Model**:
    *   In the Explorer, double-click `scene-script.js`.
    *   Modify the `update` function to change the model's rotation, position, or scale. For example, change `state.modelRotation += deltaTime * 0.5;` to `state.modelRotation += deltaTime * 2.0;` to make it spin faster.
3.  **Change its Appearance**:
    *   In the Explorer, double-click `default.frag` under the "Shaders" folder.
    *   Modify the GLSL code. For example, to make untextured objects red, change the `else` block to `gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);`.
4.  **See Your Changes**:
    *   Click the **Run** button in the editor footer.
    *   Alternatively, check the **Auto Refresh** box, and your changes will be applied automatically 10 seconds after you stop typing.

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