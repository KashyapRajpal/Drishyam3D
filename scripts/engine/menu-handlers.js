/**
 * @file Sets up event handlers for the main menu bar.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { parseGltf } from './gltf-parser.js';
import { createDefaultCube, createDefaultTexturedCube } from './geometry.js';

/**
 * Sets up the event handlers for the main menu bar.
 * @param {object} options
 * @param {WebGLRenderingContext} options.gl - The WebGL context.
 * @param {object} options.scene - The scene manager object.
 * @param {object} options.settings - The settings manager object.
 * @param {function} options.updateScript - Callback to re-run the scene script.
 */
export function setupMenuHandlers({ gl, scene, settings, updateScript }) {
    const errorConsole = document.querySelector("#error-console");
    const importModelBtn = document.querySelector('#import-model-btn');
    const modelFileInput = document.querySelector('#model-file-input');
    const resetSceneBtn = document.querySelector('#reset-scene-btn');

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
        reader.onerror = () => console.error("Failed to read file:", reader.error);
        reader.readAsArrayBuffer(file);
    });

    resetSceneBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const useTextured = settings.get('useTexturedDefaultCube');
        const cube = useTextured ? await createDefaultTexturedCube(gl) : createDefaultCube(gl);
        scene.loadGeometry(cube);
        updateScript();
        console.log("Scene reset to default.");
    });
}