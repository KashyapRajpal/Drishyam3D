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
export function setupMenuHandlers({ gl, scene, settings, updateScript, camera }) {
    const shapesMenu = document.querySelector('#shapes-menu-container');
    const errorConsole = document.querySelector("#error-console");
    const importZipBtn = document.querySelector('#import-zip-btn');
    const importFolderBtn = document.querySelector('#import-folder-btn');
    const modelFileInput = document.querySelector('#model-file-input');
    const loadSampleGltfBtn = document.querySelector('#load-sample-gltf-btn');
    const resetSceneBtn = document.querySelector('#reset-scene-btn');

    // --- Shape Menu Buttons ---
    const shapeTexturedCheckbox = document.querySelector('#shape-textured-checkbox');
    const shapeCubeBtn = document.querySelector('#shape-cube-btn');
    const shapeSphereBtn = document.querySelector('#shape-sphere-btn');

    let currentShapeLoader = null; // This will hold a function to reload the current shape
    let pickerActive = false;

    async function buildFileMapFromDirectory(dirHandle, prefix = '') {
        const fileMap = new Map();
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                const file = await entry.getFile();
                fileMap.set(prefix + entry.name, file);
            } else if (entry.kind === 'directory') {
                const subMap = await buildFileMapFromDirectory(entry, `${prefix}${entry.name}/`);
                subMap.forEach((file, path) => fileMap.set(path, file));
            }
        }
        return fileMap;
    }

    async function getJSZip() {
        if (typeof JSZip !== 'undefined') return JSZip;
        if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
        try {
            const mod = await import('jszip');
            return mod.default || mod;
        } catch (e) {
            return null;
        }
    }

    function frameCamera(drawable) {
        if (!camera || !drawable || !drawable.bounds) return;
        const { center, radius } = drawable.bounds;
        if (!center || !radius) return;
        camera.target = center;
        const desiredZoom = Math.max(radius * 2.5, 2);
        camera.maxZoom = Math.max(camera.maxZoom || 0, desiredZoom * 2);
        camera.zoom = desiredZoom;
        camera.updateViewMatrix();
    }

    async function processZipFile(file) {
        const JSZipLib = await getJSZip();
        if (!JSZipLib) {
            throw new Error("JSZip library is not loaded. Cannot process .zip file.");
        }
        console.log("Processing .zip file...");
        const zip = await JSZipLib.loadAsync(file);
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
        const drawable = await parseGltf(gl, fileMap);
        scene.loadGeometry(drawable);
        frameCamera(drawable);
        console.log('GLTF model loaded from zip:', drawable);
        updateScript();
        currentShapeLoader = null;
        shapesMenu.classList.add('disabled');
    }

    async function processFolderHandle(dirHandle, preferredGltfName) {
        const dirMap = await buildFileMapFromDirectory(dirHandle);
        const gltfPaths = Array.from(dirMap.keys()).filter((p) => p.toLowerCase().endsWith('.gltf'));
        if (gltfPaths.length === 0) {
            throw new Error("No .gltf file found in the selected folder.");
        }

        let selectedPath = null;
        if (preferredGltfName) {
            selectedPath = gltfPaths.find((p) => p.endsWith(`/${preferredGltfName}`) || p === preferredGltfName);
        }
        if (!selectedPath) {
            const rootCandidates = gltfPaths.filter((p) => !p.includes('/'));
            if (rootCandidates.length === 1) selectedPath = rootCandidates[0];
        }
        if (!selectedPath) {
            gltfPaths.sort((a, b) => a.localeCompare(b));
            selectedPath = gltfPaths[0];
        }

        const orderedMap = new Map();
        orderedMap.set(selectedPath, dirMap.get(selectedPath));
        dirMap.forEach((val, key) => {
            if (key !== selectedPath) orderedMap.set(key, val);
        });

        const drawable = await parseGltf(gl, orderedMap);
        scene.loadGeometry(drawable);
        frameCamera(drawable);
        console.log('GLTF model loaded from folder:', drawable);
        updateScript();
        currentShapeLoader = null;
        shapesMenu.classList.add('disabled');
    }

    function openFileInput(mode, accept) {
        if (!modelFileInput) return;
        modelFileInput.dataset.mode = mode;
        modelFileInput.accept = accept;
        modelFileInput.multiple = false;
        modelFileInput.value = null;
        modelFileInput.click();
    }

    const onImportZipClick = async (e) => {
        e.preventDefault();
        if (pickerActive || window.__DRISHYAM_PICKER_ACTIVE) return;
        pickerActive = true;
        window.__DRISHYAM_PICKER_ACTIVE = true;

        scene.loadGeometry(null);

        try {
            if (!window.showOpenFilePicker) {
                openFileInput('zip', '.zip');
                return;
            }
            const handles = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: 'Zip Archives',
                        accept: {
                            'application/zip': ['.zip'],
                            'application/x-zip-compressed': ['.zip'],
                            'application/octet-stream': ['.zip']
                        }
                    }
                ]
            });
            const handle = handles && handles[0];
            if (!handle) return;
            const file = await handle.getFile();
            await processZipFile(file);
        } catch (error) {
            if (error.name === 'AbortError') {
                // user cancelled
            } else if (error && String(error.message).includes('File picker already active')) {
                // ignore duplicate picker errors
            } else {
                console.error("Failed to load model from ZIP import:", error);
                const msg = error && error.message ? error.message : String(error);
                errorConsole.textContent = `GLTF Error: ${msg}`;
                errorConsole.style.display = 'block';
            }
        } finally {
            pickerActive = false;
            window.__DRISHYAM_PICKER_ACTIVE = false;
        }
    };
    if (importZipBtn) importZipBtn.addEventListener('click', onImportZipClick);

    const onImportFolderClick = async (e) => {
        e.preventDefault();
        if (pickerActive || window.__DRISHYAM_PICKER_ACTIVE) return;
        pickerActive = true;
        window.__DRISHYAM_PICKER_ACTIVE = true;

        scene.loadGeometry(null);

        try {
            if (!window.showDirectoryPicker) {
                throw new Error("Directory picker not supported. Use 'Import Zip' instead.");
            }
            const dirHandle = await window.showDirectoryPicker();
            await processFolderHandle(dirHandle);
        } catch (error) {
            if (error.name === 'AbortError') {
                // user cancelled
            } else if (error && String(error.message).includes('File picker already active')) {
                // ignore duplicate picker errors
            } else {
                console.error("Failed to load model from folder import:", error);
                const msg = error && error.message ? error.message : String(error);
                errorConsole.textContent = `GLTF Error: ${msg}`;
                errorConsole.style.display = 'block';
            }
        } finally {
            pickerActive = false;
            window.__DRISHYAM_PICKER_ACTIVE = false;
        }
    };
    if (importFolderBtn) importFolderBtn.addEventListener('click', onImportFolderClick);

    const onModelFileChange = async (event) => {
        const files = event.target.files;
        // If we temporarily enabled webkitdirectory for folder selection, remove it after selection
        try { event.target.removeAttribute && event.target.removeAttribute('webkitdirectory') } catch (e) {}
        if (!files || files.length === 0) return;

        // Hide current geometry while loading a model
        scene.loadGeometry(null);

        try {
            const mode = event.target.dataset.mode || '';
            event.target.dataset.mode = '';

            if (mode === 'zip') {
                if (files.length !== 1 || !files[0].name.endsWith('.zip')) {
                    throw new Error("Please select a .zip file.");
                }
                await processZipFile(files[0]);
            } else {
                throw new Error("Unsupported import mode.");
            }
        } catch (error) {
            console.error("Failed to load model from file input:", error);
            errorConsole.textContent = `GLTF Error: ${error.message}`;
            errorConsole.style.display = 'block';
        }
    };
    modelFileInput.addEventListener('change', onModelFileChange);

    const onLoadSample = async (e) => {
        e.preventDefault();
        const sampleUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTextured/glTF/BoxTextured.gltf';
        console.log(`Loading sample GLTF from: ${sampleUrl}`);
        try {
            const drawable = await parseGltf(gl, sampleUrl);
            scene.loadGeometry(drawable);
            currentShapeLoader = null; // A loaded model is not a primitive shape
            shapesMenu.classList.add('disabled');
        } catch (error) {
            console.error("Failed to load sample GLTF model:", error);
            errorConsole.textContent = `Sample GLTF Error: ${error.message}`;
            errorConsole.style.display = 'block';
        }
    };
    loadSampleGltfBtn.addEventListener('click', onLoadSample);

    const onResetScene = async (e) => {
        e.preventDefault();
        // Resetting the scene now defaults to the simple cube.
        const cube = createDefaultCube(gl);
        console.log('onResetScene. Loading cube.');
        scene.loadGeometry(cube);
        updateScript();
        shapesMenu.classList.remove('disabled');
        console.log("Scene reset to default cube.");
    };
    resetSceneBtn.addEventListener('click', onResetScene);

    // --- Shape Loading Handlers ---
    const loadCube = async () => {
        const isTextured = shapeTexturedCheckbox.checked;
        const cube = isTextured ? await createDefaultTexturedCube(gl) : createDefaultCube(gl);
        scene.loadGeometry(cube);
        console.log(`shape loadCube called.`);
        console.log(`Loaded: ${isTextured ? 'Textured' : 'Default'} Cube`);
    };

    const loadSphere = async () => {
        const isTextured = shapeTexturedCheckbox.checked;
        const sphere = isTextured ? await createTexturedSphere(gl) : createSphere(gl);
        scene.loadGeometry(sphere);
        console.log(`shape loadSphere called.`);
        console.log(`Loaded: ${isTextured ? 'Textured' : 'Default'} Sphere`);
    };

    const onShapeCube = (e) => { e.preventDefault(); currentShapeLoader = loadCube; currentShapeLoader(); };
    const onShapeSphere = (e) => { e.preventDefault(); currentShapeLoader = loadSphere; currentShapeLoader(); };
    shapeCubeBtn.addEventListener('click', onShapeCube);
    shapeSphereBtn.addEventListener('click', onShapeSphere);

    const onTexturedChange = () => { if (currentShapeLoader) currentShapeLoader(); };
    shapeTexturedCheckbox.addEventListener('change', onTexturedChange);

    // Return a cleanup function so callers can remove handlers and avoid duplicates
    return () => {
        if (importZipBtn) importZipBtn.removeEventListener('click', onImportZipClick);
        if (importFolderBtn) importFolderBtn.removeEventListener('click', onImportFolderClick);
        modelFileInput.removeEventListener('change', onModelFileChange);
        loadSampleGltfBtn.removeEventListener('click', onLoadSample);
        resetSceneBtn.removeEventListener('click', onResetScene);
        shapeCubeBtn.removeEventListener('click', onShapeCube);
        shapeSphereBtn.removeEventListener('click', onShapeSphere);
        shapeTexturedCheckbox.removeEventListener('change', onTexturedChange);
    };
}

