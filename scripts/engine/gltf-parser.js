/**
 * @file A simple GLTF model parser.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix } from './matrix.js';
import { prepareRayScene } from './raytracing/core/ray-scene.js';
import { uploadGltfWebGL, uploadGltfWebGPU } from './gltf-upload.js';

export { getWebGLComponentType } from './gltf-upload.js';

// This is a simplified GLTF loader designed to handle basic GLTF 2.0 files,
// particularly those with a single external .bin file and external textures,
// like the Khronos BoxTextured sample. It does not implement the full GLTF spec.


/**
 * Extracts typed array data from a GLTF buffer view.
 * @param {ArrayBuffer} bufferData The raw binary buffer data.
 * @param {object} bufferView The GLTF bufferView object.
 * @param {object} accessor The GLTF accessor object.
 * @returns {TypedArray} The extracted typed array.
 */
export function getBufferViewData(bufferData, bufferView, accessor) {
    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    
    let elementCount;
    switch (accessor.type) {
        case 'VEC3': elementCount = accessor.count * 3; break;
        case 'VEC2': elementCount = accessor.count * 2; break;
        case 'SCALAR': elementCount = accessor.count; break;
        default: throw new Error(`Unsupported accessor type: ${accessor.type}`);
    }
    
    switch (accessor.componentType) {
        // The third argument to the TypedArray constructor is the number of ELEMENTS, not bytes.
        case 5120: return new Int8Array(bufferData, byteOffset, elementCount);
        case 5121: return new Uint8Array(bufferData, byteOffset, elementCount);
        case 5122: return new Int16Array(bufferData, byteOffset, elementCount);
        case 5123: return new Uint16Array(bufferData, byteOffset, elementCount);
        case 5125: return new Uint32Array(bufferData, byteOffset, elementCount);
        case 5126: return new Float32Array(bufferData, byteOffset, elementCount);
        default: throw new Error(`Unsupported accessor component type: ${accessor.componentType}`);
    }
}

/** Converts the retained single-primitive asset into the shared ray-scene contract. */
export function assetToRayScene(asset) {
    if (asset.rayScene) return asset.rayScene;
    return prepareRayScene({
        geometries: [{
            id: 0,
            revision: 0,
            positions: asset.positions,
            normals: asset.normals,
            texCoords: asset.texCoords || new Float32Array((asset.positions.length / 3) * 2),
            indices: asset.indices,
        }],
        instances: [{
            id: 0,
            geometryIndex: 0,
            materialIndex: 0,
            worldMatrix: createIdentityMatrix(),
        }],
        materials: [asset.material || { baseColor: [1, 1, 1, 1] }],
        lights: [],
        environment: { color: [0, 0, 0] },
    });
}

/**
 * Parses a GLTF file and prepares it for rendering.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ArrayBuffer | string | FileList | Map<string, File>} source The raw GLTF file data as an ArrayBuffer, a URL, a FileList, or a Map of file paths to File objects.
 * @returns {Promise<{buffers: object, vertexCount: number}>} A drawable object for the scene.
 */
export async function parseGltf(gl, source) {
    const asset = await parseGltfAsset(source);
    const drawable = uploadGltfWebGL(gl, asset);
    console.log('GLTF model parsed successfully:', drawable, drawable._debug);
    return drawable;
}

/**
 * Parses and uploads GLTF for the active rendering backend.
 * @param {{gl?: WebGLRenderingContext, device?: GPUDevice}} engine
 * @param {ArrayBuffer | string | FileList | Map<string, File>} source
 * @returns {Promise<object>}
 */
export async function parseGltfForBackend(engine, source) {
    const asset = await parseGltfAsset(source);
    if (engine?.gl) return uploadGltfWebGL(engine.gl, asset);
    if (engine?.device) return uploadGltfWebGPU(engine.device, asset);
    throw new Error('Unsupported engine context. Expected WebGL or WebGPU engine.');
}

/**
 * Resolves a glTF-referenced resource against a local file map by exact path,
 * then falls back to matching on basename. The fallback lets a flat selection
 * (file handles carry only bare names, no folders) satisfy a URI like
 * `textures/foo.jpg`; a directory selection (which keeps relative paths) hits
 * the exact-path branch.
 * @param {Map<string, File>} localFileMap
 * @param {string} fullPath baseUrl + uri
 * @returns {File|null}
 */
function resolveLocalFile(localFileMap, fullPath) {
    if (localFileMap.has(fullPath)) return localFileMap.get(fullPath);
    const base = fullPath.split('/').pop();
    for (const [key, file] of localFileMap) {
        if (key.split('/').pop() === base) return file;
    }
    return null;
}

/**
 * Parses GLTF into backend-agnostic typed arrays and optional texture bitmap.
 * @param {ArrayBuffer | string | FileList | Map<string, File>} source
 * @returns {Promise<object>}
 */
export async function parseGltfAsset(source) {
    let gltfJson;
    let baseUrl = '';
    const localFileMap = new Map();
    let sourceName = 'gltf';

    function listAvailableFiles(limit = 10) {
        const keys = Array.from(localFileMap.keys());
        return keys.slice(0, limit);
    }

    if (typeof source === 'string') {
        // Assume source is a URL to a .gltf file
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Failed to fetch GLTF from ${source}: ${response.statusText}`);
        gltfJson = await response.json();
        baseUrl = source.substring(0, source.lastIndexOf('/') + 1);
        const urlParts = source.split('/');
        const fileName = urlParts[urlParts.length - 1] || '';
        sourceName = fileName.replace(/\.[^/.]+$/, '') || 'gltf';
    } else if ((typeof FileList !== 'undefined' && source instanceof FileList) || source instanceof Map) {
        // Find the main .gltf or .glb file
        let mainFilePath = Array.from(source.keys()).find(path => path.endsWith('.gltf') || path.endsWith('.glb'));
        if (!mainFilePath) throw new Error("No .gltf or .glb file found in selection.");

        const mainFile = source.get(mainFilePath);

        // Determine the base path from the main GLTF file's location
        const lastSlash = mainFilePath.lastIndexOf('/');
        if (lastSlash > -1) {
            baseUrl = mainFilePath.substring(0, lastSlash + 1);
        }

        const fileBuffer = await mainFile.arrayBuffer();
        gltfJson = JSON.parse(new TextDecoder('utf-8').decode(fileBuffer));

        const mainFileName = mainFilePath.split('/').pop() || mainFilePath;
        sourceName = mainFileName.replace(/\.[^/.]+$/, '') || 'gltf';

        // The source is already a map of paths to files, so we can use it directly.
        source.forEach((value, key) => localFileMap.set(key, value));

    } else if (source instanceof ArrayBuffer) {
        const decoder = new TextDecoder('utf-8');
        gltfJson = JSON.parse(decoder.decode(source));
    } else {
        throw new Error("Unsupported GLTF source type. Must be URL string or ArrayBuffer.");
    }

    if (!gltfJson || !gltfJson.meshes || gltfJson.meshes.length === 0) {
        throw new Error("GLTF file does not contain any meshes.");
    }

    // For simplicity, we'll load the first primitive of the first mesh.
    const mesh = gltfJson.meshes[0];
    const primitive = mesh.primitives[0];

    // Get accessor data for positions, normals, texcoords, and indices
    const positionAccessor = gltfJson.accessors[primitive.attributes.POSITION];
    const normalAccessor = gltfJson.accessors[primitive.attributes.NORMAL];
    const texCoordAccessor = gltfJson.accessors[primitive.attributes.TEXCOORD_0];
    const indicesAccessor = gltfJson.accessors[primitive.indices];

    if (!positionAccessor || !normalAccessor || !indicesAccessor) {
        throw new Error("Mesh is missing required attributes (POSITION, NORMAL, or indices).");
    }

    // --- Buffers ---
    // Assuming a single binary buffer for simplicity (like BoxTextured.bin)
    const buffer = gltfJson.buffers[0];
    let binaryBufferData;

    if (buffer.uri) {
        const bufferPath = baseUrl + buffer.uri;
        const localBinFile = resolveLocalFile(localFileMap, bufferPath);
        if (localBinFile) {
            binaryBufferData = await localBinFile.arrayBuffer();
        } else if (baseUrl) {
            const bufferResponse = await fetch(baseUrl + buffer.uri);
            if (!bufferResponse.ok) throw new Error(`Failed to fetch binary buffer from ${baseUrl + buffer.uri}`);
            binaryBufferData = await bufferResponse.arrayBuffer();
        } else {
            throw new Error(`Cannot resolve buffer URI: ${buffer.uri}. baseUrl=${baseUrl || '(empty)'}; available files (sample): ${listAvailableFiles().join(', ')}`);
        }
    } else {
        throw new Error("Embedded GLTF buffers are not yet supported by this simple loader.");
    }

    const bufferViews = gltfJson.bufferViews;

    const positions = getBufferViewData(binaryBufferData, bufferViews[positionAccessor.bufferView], positionAccessor);
    const normals = getBufferViewData(binaryBufferData, bufferViews[normalAccessor.bufferView], normalAccessor);
    const indices = getBufferViewData(binaryBufferData, bufferViews[indicesAccessor.bufferView], indicesAccessor);
    let texCoords = null;
    if (texCoordAccessor) {
        texCoords = getBufferViewData(binaryBufferData, bufferViews[texCoordAccessor.bufferView], texCoordAccessor);
    }

    // --- Texture (if it exists) ---
    let textureBitmap = null;
    const material = gltfJson.materials?.[primitive.material];
    const pbr = material?.pbrMetallicRoughness || {};
    const retainedMaterial = {
        baseColor: [...(pbr.baseColorFactor || [1, 1, 1, 1])],
        emissive: [...(material?.emissiveFactor || [0, 0, 0])],
        emissiveStrength: material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 0,
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        baseColorImageIndex: pbr.baseColorTexture?.index ?? -1,
    };
    if (material && material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorTexture) {
        const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
        const gltfTexture = gltfJson.textures[textureInfo.index];
        const imageSource = gltfJson.images[gltfTexture.source];
        
        if (imageSource.uri) {
            let imageFile = null;
            let imageUrl;
            const imagePath = baseUrl + imageSource.uri;
            const localImageFile = resolveLocalFile(localFileMap, imagePath);
            if (localImageFile) {
                imageFile = localImageFile;
            } else if (baseUrl) {
                imageUrl = baseUrl + imageSource.uri;
            } else {
                throw new Error(`Cannot resolve image URI: ${imageSource.uri}. baseUrl=${baseUrl || '(empty)'}; available files (sample): ${listAvailableFiles().join(', ')}`);
            }

            if (imageFile) {
                textureBitmap = await createImageBitmap(imageFile);
            } else {
                const imageResponse = await fetch(imageUrl);
                if (!imageResponse.ok) {
                    throw new Error(`Failed to load texture from ${imageUrl}: ${imageResponse.status} ${imageResponse.statusText}`);
                }
                const imageBlob = await imageResponse.blob();
                textureBitmap = await createImageBitmap(imageBlob);
            }
        } else {
            throw new Error("Embedded GLTF images are not yet supported by this simple loader.");
        }
    }

    // Compute bounds for camera framing (no scaling applied)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }
    const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const radius = Math.max(dx, dy, dz) / 2 || 1;

    const asset = {
        sourceName,
        positions,
        normals,
        texCoords,
        indices,
        indicesComponentType: indicesAccessor.componentType,
        textureBitmap,
        material: retainedMaterial,
        materials: [retainedMaterial],
        bounds: { center, radius },
        rasterPrimitives: [{
            positions,
            normals,
            texCoords,
            indices,
            indicesComponentType: indicesAccessor.componentType,
            materialIndex: 0,
            worldMatrix: createIdentityMatrix(),
        }],
    };
    asset.rayScene = assetToRayScene(asset);
    return asset;
}
