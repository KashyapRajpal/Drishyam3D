/**
 * @file Helper functions for WebGL shader compilation and linking.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

// Shader loading function
function loadShader(gl, type, source) {
    const errorConsole = document.querySelector("#error-console");
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const shaderType = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
        const errorMsg = `${shaderType} Shader Compile Error: ${gl.getShaderInfoLog(shader)}`;
        errorConsole.textContent = errorMsg;
        console.error(errorMsg);
        errorConsole.style.display = 'block';
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

// Shader initialization function
export function initShaderProgram(gl, vsSource, fsSource) {
    const errorConsole = document.querySelector("#error-console");
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) {
        return null;
    }

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        const errorMsg = `Shader Program Link Error: ${gl.getProgramInfoLog(shaderProgram)}`;
        errorConsole.textContent = errorMsg;
        console.error(errorMsg);
        errorConsole.style.display = 'block';
        return null;
    }

    return shaderProgram;
}