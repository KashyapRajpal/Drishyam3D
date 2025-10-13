import {
    createIdentityMatrix,
    createPerspectiveMatrix,
    translateMatrix,
    rotateMatrix
} from './matrix.js';
import { initShaderProgram } from './webgl-helpers.js';
import { initCubeBuffers } from './geometry.js';
import { setupEditors } from './editor.js';

window.onload = function() {
    const canvas = document.querySelector("#glcanvas");
    const gl = canvas.getContext("webgl");
    const errorConsole = document.querySelector("#error-console");

    // Setup editors and get their instances
    const { shaderEditor, scriptEditor } = setupEditors(() => {
        updateShader();
        updateScript();
    });

    // Check if WebGL is available
    if (!gl) {
        alert("Unable to initialize WebGL. Your browser may not support it.");
        return;
    }
    
    let programInfo = null;
    let userScript = {
        init: () => {},
        update: () => {}
    };

    function updateShader() {
        const shaderCode = shaderEditor.getValue();
        const vsSource = `
            attribute vec4 aVertexPosition;
            attribute vec3 aVertexNormal;

            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;

            varying highp vec3 vLighting;

            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;

                // Apply lighting effect
                highp vec3 ambientLight = vec3(0.3, 0.3, 0.3);
                highp vec3 directionalLightColor = vec3(1, 1, 1);
                highp vec3 directionalVector = normalize(vec3(0.85, 0.8, 0.75));

                highp float directional = max(dot(aVertexNormal, directionalVector), 0.0);
                vLighting = ambientLight + (directionalLightColor * directional);
            }
        `;
        const fsSource = shaderCode;

        const newShaderProgram = initShaderProgram(gl, vsSource, fsSource);
        if (newShaderProgram) {
            programInfo = {
                program: newShaderProgram,
                attribLocations: {
                    vertexPosition: gl.getAttribLocation(newShaderProgram, "aVertexPosition"),
                    vertexNormal: gl.getAttribLocation(newShaderProgram, "aVertexNormal"),
                },
                uniformLocations: {
                    projectionMatrix: gl.getUniformLocation(newShaderProgram, "uProjectionMatrix"),
                    modelViewMatrix: gl.getUniformLocation(newShaderProgram, "uModelViewMatrix"),
                },
            };
            console.log("Shader reloaded successfully.");
            errorConsole.style.display = 'none';
        } else {
            console.error("Shader compilation failed.");
        }
    }

    function updateScript() {
        const scriptCode = scriptEditor.getValue();
        try {
            // Use a Function constructor to safely parse the user code.
            // It should return an object with init and update methods.
            const scriptModule = new Function('translateMatrix', 'rotateMatrix', `${scriptCode}\n return { init, update };`)(translateMatrix, rotateMatrix);

            if (scriptModule && typeof scriptModule.init === 'function' && typeof scriptModule.update === 'function') {
                userScript = scriptModule;
                userScript.init(sceneState); // Initialize the new script
                console.log("Scene script reloaded successfully.");
                errorConsole.style.display = 'none';
            } else {
                throw new Error("Script must export 'init' and 'update' functions.");
            }
        } catch (e) {
            console.error("Scene script error:", e);
            errorConsole.textContent = e.message;
            errorConsole.style.display = 'block';
        }
    }

    // Initialize buffers for a 3D cube
    const buffers = initCubeBuffers(gl);

    // State object to be passed to user scripts
    const sceneState = {
        cubeRotation: 0.0,
        modelViewMatrix: null,
    };

    let then = 0;

    function render(now) {
        now *= 0.001; // Convert to seconds
        const deltaTime = now - then;
        then = now;

        if (!programInfo) {
            requestAnimationFrame(render);
            return;
        }

        // Resize canvas to display size
        resizeCanvas(canvas);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Create projection matrix
        const fieldOfView = 45 * Math.PI / 180; // in radians
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar);

        // Create model-view matrix
        const modelViewMatrix = createIdentityMatrix();
        sceneState.modelViewMatrix = modelViewMatrix;

        userScript.update(sceneState, deltaTime);

        // Set vertex attributes
        {
            const numComponents = 3;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
            gl.vertexAttribPointer(
                programInfo.attribLocations.vertexPosition,
                numComponents, type, normalize, stride, offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
        }

        // Set normal attributes
        {
            const numComponents = 3;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
            gl.vertexAttribPointer(
                programInfo.attribLocations.vertexNormal,
                numComponents, type, normalize, stride, offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);
        }

        // Tell WebGL which indices to use to index the vertices
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

        // Set the shader program to use
        gl.useProgram(programInfo.program);

        // Set the shader uniforms
        gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);

        {
            const vertexCount = 36;
            const type = gl.UNSIGNED_SHORT;
            const offset = 0;
            gl.drawElements(gl.TRIANGLES, vertexCount, type, offset);
        }

        requestAnimationFrame(render);
    }

    // Initial shader compilation and start rendering loop
    updateShader();
    updateScript();
    shaderEditor.refresh(); // Initial refresh for CodeMirror
    requestAnimationFrame(render);
};

 function resizeCanvas(canvas) {
    const displayWidth  = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width  !== displayWidth || canvas.height !== displayHeight) {
      canvas.width  = displayWidth;
      canvas.height = displayHeight;
    }
}