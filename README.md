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

This project is a client-side application and does not require a complex build process.

1.  Clone the repository.
2.  Open the `webglapp/html/mainpage.html` file in a modern web browser (like Chrome, Firefox, or Edge).

For the best experience and to avoid potential browser security restrictions (especially when loading external files in the future), it's recommended to use a simple local web server:

```bash
# If you have Python 3 installed:
python -m http.server

# Then navigate to http://localhost:8000/webglapp/html/mainpage.html
```