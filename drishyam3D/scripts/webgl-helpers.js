// Shader loading function
function loadShader(gl, type, source) {
    const errorConsole = document.querySelector("#error-console");
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const errorMsg = `Shader compile error: ${gl.getShaderInfoLog(shader)}`;
        errorConsole.textContent = errorMsg;
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
        const errorMsg = "Shader program link error: " + gl.getProgramInfoLog(shaderProgram);
        errorConsole.textContent = errorMsg;
        errorConsole.style.display = 'block';
        return null;
    }

    return shaderProgram;
}