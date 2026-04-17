/**
 * @file Pure scene operations (shape loading, GLTF import, reset) driven by UI.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { parseGltf } from './gltf-parser.js';

export function frameCamera(camera, drawable) {
    if (!camera || !drawable || !drawable.bounds) return;
    const { center, radius } = drawable.bounds;
    if (!center || !radius) return;
    camera.target = center;
    const desiredZoom = Math.max(radius * 2.5, 2);
    camera.maxZoom = Math.max(camera.maxZoom || 0, desiredZoom * 2);
    camera.zoom = desiredZoom;
    camera.updateViewMatrix();
}

export async function loadShape({ engine, geometryFactory, shape, textured }) {
    if (!engine || !geometryFactory) return;
    const key = (textured ? 'createTextured' : 'create') + shape.charAt(0).toUpperCase() + shape.slice(1);
    const factoryFn = geometryFactory[key];
    if (typeof factoryFn !== 'function') {
        throw new Error(`Geometry factory has no method '${key}'`);
    }
    const drawable = await factoryFn();
    engine.scene.loadGeometry(drawable);
}

export async function resetScene({ engine, geometryFactory }) {
    const cube = geometryFactory.createCube();
    engine.scene.loadGeometry(cube);
}

export async function loadSampleGltf({ engine }) {
    const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTextured/glTF/BoxTextured.gltf';
    const drawable = await parseGltf(engine.gl, url);
    engine.scene.loadGeometry(drawable);
    frameCamera(engine.camera, drawable);
    return drawable;
}

async function getJSZip() {
    if (typeof JSZip !== 'undefined') return JSZip;
    if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
    const mod = await import('jszip');
    return mod.default || mod;
}

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

export async function importZipFile({ engine, file }) {
    const JSZipLib = await getJSZip();
    if (!JSZipLib) throw new Error('JSZip library is not loaded. Cannot process .zip file.');

    const zip = await JSZipLib.loadAsync(file);
    const fileMap = new Map();
    const filePromises = [];
    zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
            filePromises.push(
                zipEntry.async('blob').then((blob) => {
                    fileMap.set(relativePath, new File([blob], zipEntry.name));
                })
            );
        }
    });
    await Promise.all(filePromises);

    const drawable = await parseGltf(engine.gl, fileMap);
    engine.scene.loadGeometry(drawable);
    frameCamera(engine.camera, drawable);
    return drawable;
}

export async function importFolderHandle({ engine, dirHandle, preferredGltfName }) {
    const dirMap = await buildFileMapFromDirectory(dirHandle);
    const gltfPaths = Array.from(dirMap.keys()).filter((p) => p.toLowerCase().endsWith('.gltf'));
    if (gltfPaths.length === 0) {
        throw new Error('No .gltf file found in the selected folder.');
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

    const drawable = await parseGltf(engine.gl, orderedMap);
    engine.scene.loadGeometry(drawable);
    frameCamera(engine.camera, drawable);
    return drawable;
}
