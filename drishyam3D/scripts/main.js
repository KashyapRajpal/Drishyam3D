import {
    translateMatrix,
    rotateMatrix
} from './matrix.js';
import { initShaderProgram } from './webgl-helpers.js';
import { setupEditors } from './editor.js';
import { createScene } from './scene.js';

window.onload = function() {
    const canvas = document.querySelector("#glcanvas");
    const gl = canvas.getContext("webgl");
    const errorConsole = document.querySelector("#error-console");

    // Setup editors and get their instances
    const { vertexShaderEditor, fragmentShaderEditor, scriptEditor } = setupEditors(() => {
        updateShader();
        updateScript();
    });

    // Check if WebGL is available
    if (!gl) {
        alert("Unable to initialize WebGL. Your browser may not support it.");
        return;
    }
    
    const scene = createScene(gl, canvas);
    function updateShader() {
        const vsSource = vertexShaderEditor.getValue();
        const fsSource = fragmentShaderEditor.getValue();

        const newShaderProgram = initShaderProgram(gl, vsSource, fsSource);
        if (newShaderProgram) {
            const newProgramInfo = {
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
            scene.updateProgramInfo(newProgramInfo);
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
                scene.updateUserScript(scriptModule);
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

    // Initial shader compilation and start rendering loop
    updateShader();
    updateScript();
    fragmentShaderEditor.refresh(); // Initial refresh for CodeMirror
    scene.start();
};