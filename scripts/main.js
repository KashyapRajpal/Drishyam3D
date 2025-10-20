import {
    translateMatrix,
    rotateMatrix
} from './matrix.js';
import { initShaderProgram } from './webgl-helpers.js';
import { setupEditors } from './editor.js';
import { initCubeBuffers } from './geometry.js';
import { parseGltf } from './gltf-parser.js';
import { setupExplorer } from './explorer.js';
import { createScene } from './scene.js';

window.onload = function() {
    const canvas = document.querySelector("#glcanvas"); 
    const gl = canvas.getContext("webgl");
    const errorConsole = document.querySelector("#error-console");
    const reloadButton = document.querySelector('#reload-button');

    let isAutoRefreshEnabled = false;
    let autoRefreshTimer = null;

    function runUpdates() {
        updateShader();
        updateScript();
        editorManager.clearAllDirtyStates();
        reloadButton.disabled = true; // Disable button after updates are applied
    }

    function resetAutoRefreshTimer() {
        clearTimeout(autoRefreshTimer);
        if (isAutoRefreshEnabled) {
            autoRefreshTimer = setTimeout(runUpdates, 10000); // 10 seconds
        }
    }

    function onEditorChange() {
        reloadButton.disabled = false; // Enable button on any change
        resetAutoRefreshTimer();
    }

    // Setup editors and get their instances
    const editorManager = setupEditors(runUpdates, onEditorChange);
    reloadButton.disabled = true; // Start with the button disabled

    const autoRefreshCheckbox = document.querySelector('#auto-refresh-checkbox');
    autoRefreshCheckbox.addEventListener('change', (event) => {
        isAutoRefreshEnabled = event.target.checked;
        // Start or stop the timer based on the new state.
        // If disabling, the existing timer is cleared. If enabling, a new timer is set.
        resetAutoRefreshTimer();
    });

    const explorer = setupExplorer((fileId, fileName, fileType, readOnly, path) => editorManager.openEditor(fileId, fileName, fileType, readOnly, path));

    // --- Model Importer Logic ---
    const importModelBtn = document.querySelector('#import-model-btn');
    const modelFileInput = document.querySelector('#model-file-input');

    importModelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        modelFileInput.click();
    });

    modelFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const drawable = await parseGltf(gl, arrayBuffer);
                scene.loadGeometry(drawable);
            } catch (error) {
                console.error("Failed to load GLTF model:", error);
                errorConsole.textContent = `GLTF Error: ${error.message}`;
                errorConsole.style.display = 'block';
            }
        };
        reader.onerror = () => {
            console.error("Failed to read file:", reader.error);
        };
        reader.readAsArrayBuffer(file);
    });

    const resetSceneBtn = document.querySelector('#reset-scene-btn');
    resetSceneBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Re-load the original cube geometry
        scene.loadGeometry(cubeGeometry);
        // Re-run the script to reset its state (e.g., rotation)
        updateScript();
        console.log("Scene reset to default.");
    });

    // Check if WebGL is available
    if (!gl) {
        alert("Unable to initialize WebGL. Your browser may not support it.");
        return;
    }
    
    const scene = createScene(gl, canvas);
    // Load the initial cube geometry into the scene
    const cubeGeometry = { buffers: initCubeBuffers(gl), vertexCount: 36 };
    scene.loadGeometry(cubeGeometry);

    function updateShader() {
        const vsEditor = editorManager.getEditor('vertex');
        const fsEditor = editorManager.getEditor('fragment');
        if (!vsEditor || !fsEditor) return; // Don't compile if editors aren't open

        const vsSource = vsEditor.getValue();
        const fsSource = fsEditor.getValue();

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
        const scriptEditor = editorManager.getEditor('script');
        if (!scriptEditor) return; // Don't run if editor isn't open

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

    // --- Initial Setup ---
    // Open the default project files and wait for them to be ready.
    const openFilePromises = explorer.getProjectFiles().map(file => {
        return editorManager.openEditor(file.id, file.name, file.type, file.readOnly, file.path);
    });

    // Initial shader compilation and start rendering loop
    updateShader();
    updateScript();
    scene.start();
};