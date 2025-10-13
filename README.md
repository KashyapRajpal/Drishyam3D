# Drishyam3D - A Simple WebGL Scene Editor

Drishyam3D is a lightweight, browser-based 3D scene editor built with WebGL. It provides a simple interface for writing and testing fragment shaders and scene manipulation scripts in real-time.

## Features

*   **Live WebGL Viewport**: Renders a 3D scene directly in your browser.
*   **Dual-Panel Code Editor**:
    *   Edit **Fragment Shaders** (GLSL) to control the appearance of objects.
    *   Write **Scene Scripts** (JavaScript) to define object behavior and animations.
*   **Real-time Reload**: Instantly apply your shader and script changes by clicking the "Run" button.
*   **Error Console**: Displays compilation and runtime errors from your code to help with debugging.
*   **Basic UI**: A clean, resizable layout with tabbed editors for a smooth workflow.

## How to Run

This project uses modern JavaScript modules (`import`/`export`), which have specific security requirements in web browsers. Therefore, **you must run it using a local web server.** Opening the `mainpage.html` file directly from your filesystem (`file:///...`) will not work.

**Why is a server required?**
Modern browsers enforce a security feature called Cross-Origin Resource Sharing (CORS). When you use JavaScript modules, the browser blocks them from loading if you open the HTML file directly from your local disk (`file:///`). A local server provides the necessary `http://` protocol, which gives your project a valid "origin" and allows the modules to load correctly.

**Steps to run:**

1.  Clone the repository.
2.  Open your terminal, navigate to the project's root directory, and start a simple web server. If you have Python 3, you can use:

    ```bash
    python -m http.server
    ```

3.  Open your web browser and navigate to: `http://localhost:8000/drishyam3D/html/mainpage.html`