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
    const loadSampleGltfBtn = document.querySelector('#load-sample-gltf-btn');
    const resetSceneBtn = document.querySelector('#reset-scene-btn');

    // --- Shape Menu Buttons ---
    const shapeTexturedCheckbox = document.querySelector('#shape-textured-checkbox');
    const shapeCubeBtn = document.querySelector('#shape-cube-btn');
    const shapeSphereBtn = document.querySelector('#shape-sphere-btn');

    let currentShapeLoader = null; // This will hold a function to reload the current shape

    importModelBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        // Use the modern File System Access API (directory picker) if available
        if (window.showDirectoryPicker) {
            try {
                const dirHandle = await window.showDirectoryPicker();
                const fileMap = new Map();
                
                async function processHandle(handle, path) {
                    if (handle.kind === 'file') {
                        const file = await handle.getFile();
                        fileMap.set(path + handle.name, file);
                    } else if (handle.kind === 'directory') {
                        for await (const subHandle of handle.values()) {
                            await processHandle(subHandle, path + handle.name + '/');
                        }
                    }
                }

                await processHandle(dirHandle, ''); // Populate the fileMap
                const drawable = await parseGltf(gl, fileMap);
                scene.loadGeometry(drawable);
                currentShapeLoader = null;
            } catch (error) {
                if (error.name !== 'AbortError') { // Ignore errors from user cancelling the dialog
                    console.error("Failed to load model from directory:", error);
                    errorConsole.textContent = `GLTF Error: ${error.message}`;
                    errorConsole.style.display = 'block';
                }
            }
        } else {
            // Fallback to the old file input for browsers that don't support directory picking
            console.log("Directory Picker not supported, falling back to file input.");
            modelFileInput.value = null; // Clear previous selection
            modelFileInput.click();
        }
    });

    modelFileInput.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        try {
            let drawable;
            // Check if a single zip file was selected
            if (files.length === 1 && files[0].name.endsWith('.zip')) {
                if (typeof JSZip === 'undefined') {
                    throw new Error("JSZip library is not loaded. Cannot process .zip file.");
                }
                console.log("Processing .zip file...");
                const zip = await JSZip.loadAsync(files[0]);
                const fileMap = new Map();
                const filePromises = [];

                zip.forEach((relativePath, zipEntry) => {
                    if (!zipEntry.dir) {
                        filePromises.push(
                            zipEntry.async('blob').then(blob => {
                                fileMap.set(relativePath, new File([blob], zipEntry.name));
                            })
                        );
                    }
                });
                await Promise.all(filePromises);
                drawable = await parseGltf(gl, fileMap);
            } else {
                drawable = await parseGltf(gl, files);
            }
            scene.loadGeometry(drawable);
            currentShapeLoader = null; // A loaded model is not a primitive shape
        } catch (error) {
            console.error("Failed to load GLTF model:", error);
            errorConsole.textContent = `GLTF Error: ${error.message}`;
            errorConsole.style.display = 'block';
        }
    });

    loadSampleGltfBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const sampleUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTextured/glTF/BoxTextured.gltf';
        console.log(`Loading sample GLTF from: ${sampleUrl}`);
        try {
            const drawable = await parseGltf(gl, sampleUrl);
            scene.loadGeometry(drawable);
            currentShapeLoader = null; // A loaded model is not a primitive shape
        } catch (error) {
            console.error("Failed to load sample GLTF model:", error);
            errorConsole.textContent = `Sample GLTF Error: ${error.message}`;
            errorConsole.style.display = 'block';
        }
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