/**
 * @file Sets up event handlers for the main menu bar.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { parseGltf } from './gltf-parser.js';
import { createDefaultCube, createDefaultTexturedCube, createSphere } from './geometry.js';

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

    // --- Shape Menu Buttons ---
    const shapeTexturedCheckbox = document.querySelector('#shape-textured-checkbox');
    const shapeCubeBtn = document.querySelector('#shape-cube-btn');
    const shapeSphereBtn = document.querySelector('#shape-sphere-btn');

    let currentShapeLoader = null; // This will hold a function to reload the current shape

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
        // Resetting the scene now defaults to the simple cube.
        const cube = createDefaultCube(gl);
        scene.loadGeometry(cube);
        updateScript();
        console.log("Scene reset to default cube.");
    });

    // --- Shape Loading Handlers ---
    const loadCube = async () => {
        const isTextured = shapeTexturedCheckbox.checked;
        const cube = isTextured ? await createDefaultTexturedCube(gl) : createDefaultCube(gl);
        scene.loadGeometry(cube);
        console.log(`Loaded: ${isTextured ? 'Textured' : 'Default'} Cube`);
    };

    const loadSphere = async () => {
        const isTextured = shapeTexturedCheckbox.checked;
        const sphere = isTextured ? await createTexturedSphere(gl) : createSphere(gl);
        scene.loadGeometry(sphere);
        console.log(`Loaded: ${isTextured ? 'Textured' : 'Default'} Sphere`);
    };

    shapeCubeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        currentShapeLoader = loadCube;
        currentShapeLoader();
    });

    shapeSphereBtn.addEventListener('click', (e) => {
        e.preventDefault();
        currentShapeLoader = loadSphere;
        currentShapeLoader();
    });

    shapeTexturedCheckbox.addEventListener('change', () => {
        if (currentShapeLoader) {
            currentShapeLoader();
        }
    });
}

// We need a new function for the textured sphere, let's add it to geometry.js
import { createTexturedSphere } from './geometry.js';