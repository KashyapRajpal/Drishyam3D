/**
 * @file Pure scene operations (shape loading, GLTF import, reset) driven by UI.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { parseGltfForBackend } from './gltf-parser.js';
import { parseMeshPly } from './mesh-ply-loader.js';

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/**
 * Finds a texture file that pairs with a model file by basename.
 * For example, "Bear.ply" matches "Bear_0.jpg", "Bear_diffuse.jpg", or just "Bear.jpg".
 * Returns the first match, or null if none found.
 */
export function findTextureByBasename(modelFile, candidateFiles) {
    const modelBase = modelFile.name.replace(/\.[^.]+$/, '');
    const textures = candidateFiles.filter((f) => IMAGE_RE.test(f.name));
    // Exact base match: "Bear.ply" + "Bear.jpg" or "Bear_*.jpg"
    return textures.find((f) => {
        const texBase = f.name.replace(/\.[^.]+$/, '');
        return texBase === modelBase || texBase.startsWith(modelBase + '_');
    }) || null;
}

/**
 * Infers what a `.ply` actually contains from its ASCII header — the extension
 * alone is ambiguous (3D-Gaussian-splat clouds and triangle meshes both use it).
 * @param {string} headerText decoded header (through `end_header`)
 * @returns {'splat' | 'mesh'}
 */
export function detectPlyKind(headerText) {
    // 3DGS clouds carry per-splat SH/rotation attributes; meshes carry faces.
    if (/\bf_dc_0\b/.test(headerText) || (/\bscale_0\b/.test(headerText) && /\brot_0\b/.test(headerText))) {
        return 'splat';
    }
    if (/\belement\s+face\b/.test(headerText)) return 'mesh';
    // Bare xyz point cloud with neither signal — render it as (grey) splats.
    return 'splat';
}

/**
 * Single entry point for loading a user-picked asset. Infers the format and
 * routes to the splat / mesh / glTF path.
 * @param {{ engine: object, files: File[]|FileList, flipY?: boolean }} args
 * @returns {Promise<{ kind: 'splat'|'mesh'|'gltf', drawable: object }>}
 */
export async function loadAssetFiles({ engine, files, flipY = true }) {
    const list = Array.from(files);
    const zipFile = list.find((f) => /\.zip$/i.test(f.name));
    const gltfFile = list.find((f) => /\.(gltf|glb)$/i.test(f.name));
    const plyFile = list.find((f) => /\.ply$/i.test(f.name));

    if (zipFile) {
        const drawable = await importZipFile({ engine, file: zipFile });
        return { kind: 'gltf', drawable };
    }

    if (gltfFile) {
        const fileMap = new Map(list.map((f) => [f.name, f])); // let it resolve companion .bin / textures
        const drawable = await parseGltfForBackend(engine, fileMap);
        engine.scene.loadGeometry(drawable);
        frameCamera(engine.camera, drawable);
        return { kind: 'gltf', drawable };
    }

    if (plyFile) {
        const headerText = new TextDecoder('ascii').decode(
            new Uint8Array(await plyFile.slice(0, 64 * 1024).arrayBuffer()),
        );
        if (detectPlyKind(headerText) === 'splat') {
            const drawable = await loadSplatFile({ engine, file: plyFile, flipY });
            return { kind: 'splat', drawable };
        }
        const texture = findTextureByBasename(plyFile, list);
        const drawable = await loadMeshFile({ engine, files: texture ? [plyFile, texture] : [plyFile] });
        return { kind: 'mesh', drawable };
    }

    throw new Error('Unsupported file. Select a .gltf/.glb/.zip, or (on WebGPU) a .ply — plus a texture image if the mesh needs one.');
}

/**
 * Loads an asset from a picked directory: finds the primary `.gltf`/`.ply` and
 * pulls its companion files (`.bin`, textures) straight from the same folder.
 *
 * A directory grant is what makes "select the model, auto-load its neighbours"
 * possible — a single-file pick can't read sibling files — and it preserves the
 * relative paths (`textures/…`) that external glTF resources reference.
 *
 * @param {{ engine: object, dirHandle: FileSystemDirectoryHandle, flipY?: boolean }} args
 * @returns {Promise<{ kind: 'splat'|'mesh'|'gltf', drawable: object }>}
 */
export async function loadAssetFromDirectory({ engine, dirHandle, flipY = true }) {
    const dirMap = await buildFileMapFromDirectory(dirHandle);
    const paths = Array.from(dirMap.keys());
    const gltfPath = paths.find((p) => /\.gltf$/i.test(p));
    const plyPath = paths.find((p) => /\.ply$/i.test(p));

    if (gltfPath) {
        // Order the glTF first so parseGltfAsset picks it as the main file and
        // derives baseUrl from its folder; the rest resolve as companions.
        const orderedMap = new Map();
        orderedMap.set(gltfPath, dirMap.get(gltfPath));
        dirMap.forEach((file, path) => { if (path !== gltfPath) orderedMap.set(path, file); });
        const drawable = await parseGltfForBackend(engine, orderedMap);
        engine.scene.loadGeometry(drawable);
        frameCamera(engine.camera, drawable);
        return { kind: 'gltf', drawable };
    }

    if (plyPath) {
        const plyFile = dirMap.get(plyPath);
        const headerText = new TextDecoder('ascii').decode(
            new Uint8Array(await plyFile.slice(0, 64 * 1024).arrayBuffer()),
        );
        if (detectPlyKind(headerText) === 'splat') {
            const drawable = await loadSplatFile({ engine, file: plyFile, flipY });
            return { kind: 'splat', drawable };
        }
        const texture = findTextureByBasename(plyFile, Array.from(dirMap.values()));
        const files = texture ? [plyFile, texture] : [plyFile];
        const drawable = await loadMeshFile({ engine, files });
        return { kind: 'mesh', drawable };
    }

    throw new Error('No .gltf or .ply found in the selected folder.');
}

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

export async function loadSplatFile({ engine, file, flipY = true }) {
    if (typeof engine.loadSplats !== 'function') {
        throw new Error('Splat loading requires the WebGPU backend.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const drawable = engine.loadSplats(arrayBuffer, { flipY });
    frameCamera(engine.camera, drawable);
    return drawable;
}

/**
 * Loads a triangle-mesh `.ply` plus an optional companion image texture.
 * @param {{ engine: object, files: File[]|FileList }} args `files` should
 *        contain the `.ply` and (for textured meshes) its image.
 */
export async function loadMeshFile({ engine, files }) {
    if (typeof engine.loadMesh !== 'function') {
        throw new Error('Mesh loading requires the WebGPU backend.');
    }
    const list = Array.from(files);
    const plyFile = list.find((f) => /\.ply$/i.test(f.name));
    if (!plyFile) throw new Error('Select a .ply mesh file.');
    const imgFile = list.find((f) => IMAGE_RE.test(f.name));

    const meshData = parseMeshPly(await plyFile.arrayBuffer());
    meshData.name = plyFile.name.replace(/\.ply$/i, '');

    let textureBitmap = null;
    if (imgFile) textureBitmap = await createImageBitmap(imgFile);
    else if (meshData.hasTexture) {
        throw new Error(`"${plyFile.name}" is a textured mesh — also select its image file (e.g. the companion .jpg).`);
    }

    const drawable = engine.loadMesh({ meshData, textureBitmap });
    frameCamera(engine.camera, drawable);
    return drawable;
}

export async function loadSampleGltf({ engine }) {
    const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/BoxTextured/glTF/BoxTextured.gltf';
    const drawable = await parseGltfForBackend(engine, url);
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

    const drawable = await parseGltfForBackend(engine, fileMap);
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

    const drawable = await parseGltfForBackend(engine, orderedMap);
    engine.scene.loadGeometry(drawable);
    frameCamera(engine.camera, drawable);
    return drawable;
}
