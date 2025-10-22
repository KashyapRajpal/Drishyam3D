/**
 * @file Main entry point for the Drishyam3D application.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */
import {
    translateMatrix,
    rotateMatrix
} from './engine/matrix.js';
import { initShaderProgram } from './engine/webgl-helpers.js';
import { setupEditors } from './engine/editor.js';
import { createDefaultCube, createDefaultTexturedCube } from './engine/geometry.js';
import { parseGltf } from './engine/gltf-parser.js';
import { setupExplorer } from './engine/explorer.js';
import { setupSettings } from './engine/settings.js';
import { setupMenuHandlers } from './engine/menu-handlers.js';
import { createScene } from './engine/scene.js';

window.onload = function() {
    const canvas = document.querySelector("#glcanvas"); 
    const gl = canvas.getContext("webgl");
    const errorConsole = document.querySelector("#error-console");
    const reloadButton = document.querySelector('#reload-button');

    let isAutoRefreshEnabled = false;
    let autoRefreshTimer = null;
    let scene = null; // Declare scene in a higher scope

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

    const settings = setupSettings((setting, value) => {
        console.log(`Setting updated: ${setting} = ${value}`);
        if (setting === 'useTexturedDefaultCube') {
            // Find the reset button and trigger a click to apply the new default cube
            document.querySelector('#reset-scene-btn').click();
        }
    });

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
                    textureCoord: gl.getAttribLocation(newShaderProgram, "aTextureCoord"),
                },
                uniformLocations: {
                    projectionMatrix: gl.getUniformLocation(newShaderProgram, "uProjectionMatrix"),
                    modelViewMatrix: gl.getUniformLocation(newShaderProgram, "uModelViewMatrix"),
                    uSampler: gl.getUniformLocation(newShaderProgram, "uSampler"),
                    uBaseColor: gl.getUniformLocation(newShaderProgram, "uBaseColor"),
                    uHasTexture: gl.getUniformLocation(newShaderProgram, "uHasTexture"),
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

    async function initializeApp() {
        // Check if WebGL is available
        if (!gl) {
            alert("Unable to initialize WebGL. Your browser may not support it.");
            return;
        }

        scene = createScene(gl, canvas);

        // Always initialize with the default, untextured cube.
        const cubeGeometry = createDefaultCube(gl);
        scene.loadGeometry(cubeGeometry);

        // Setup menu handlers
        setupMenuHandlers({ gl, scene, settings, updateScript });

        // Open the default project files and wait for them to be ready.
        const openFilePromises = explorer.getProjectFiles().map(file => {
            return editorManager.openEditor(file.id, file.name, file.type, file.readOnly, file.path);
        });
        await Promise.all(openFilePromises);

        runUpdates();
        scene.start();
    }

    initializeApp();
};