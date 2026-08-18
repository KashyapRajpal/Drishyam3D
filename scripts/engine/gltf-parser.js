/**
 * @file A simple GLTF model parser.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { composeTRSMatrix, createIdentityMatrix, multiplyMatrices } from './matrix.js';
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

function defaultMaterial() {
    return {
        baseColor: [1, 1, 1, 1],
        emissive: [0, 0, 0],
        emissiveStrength: 1,
        metallic: 1,
        roughness: 1,
        baseColorImageIndex: -1,
        alphaMode: 'OPAQUE',
        doubleSided: false,
    };
}

/** Converts retained glTF scene data into the shared ray-scene contract. */
export function assetToRayScene(asset) {
    if (asset.rayScene) return asset.rayScene;
    if (asset.meshes && asset.nodes) {
        const geometries = [];
        const instances = [];
        const geometryIndices = new Map();
        for (const node of asset.nodes) {
            if (!Number.isInteger(node.meshIndex) || node.meshIndex < 0) continue;
            const mesh = asset.meshes[node.meshIndex];
            if (!mesh) throw new Error(`Node ${node.sourceNodeIndex} references missing mesh ${node.meshIndex}.`);
            mesh.primitives.forEach((primitive, primitiveIndex) => {
                const key = `${node.meshIndex}:${primitiveIndex}`;
                let geometryIndex = geometryIndices.get(key);
                if (geometryIndex == null) {
                    geometryIndex = geometries.length;
                    geometryIndices.set(key, geometryIndex);
                    geometries.push({
                        id: geometryIndex,
                        revision: 0,
                        positions: primitive.positions,
                        normals: primitive.normals,
                        texCoords: primitive.texCoords,
                        indices: primitive.indices,
                    });
                }
                instances.push({
                    id: instances.length,
                    geometryIndex,
                    materialIndex: primitive.materialIndex,
                    worldMatrix: node.worldMatrix,
                });
            });
        }
        return prepareRayScene({
            geometries,
            instances,
            materials: asset.materials,
            lights: [],
            environment: { color: [0, 0, 0] },
        });
    }
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
        materials: [asset.material || defaultMaterial()],
        lights: [],
        environment: { color: [0, 0, 0] },
    });
}

/** Creates one raster draw payload per (scene node, mesh primitive) reference. */
export function assetToRasterPrimitives(asset) {
    if (asset.rasterPrimitives) return asset.rasterPrimitives;
    if (!asset.meshes || !asset.nodes) return [];
    const primitives = [];
    for (const node of asset.nodes) {
        if (!Number.isInteger(node.meshIndex) || node.meshIndex < 0) continue;
        const mesh = asset.meshes[node.meshIndex];
        if (!mesh) throw new Error(`Node ${node.sourceNodeIndex} references missing mesh ${node.meshIndex}.`);
        for (const primitive of mesh.primitives) {
            const material = asset.materials[primitive.materialIndex];
            const imageIndex = material?.baseColorImageIndex ?? -1;
            primitives.push({
                positions: primitive.positions,
                normals: primitive.normals,
                texCoords: primitive.texCoords,
                indices: primitive.indices,
                indicesComponentType: primitive.indicesComponentType,
                materialIndex: primitive.materialIndex,
                material,
                imageIndex,
                textureBitmap: imageIndex >= 0 ? asset.images?.[imageIndex] || null : null,
                worldMatrix: node.worldMatrix,
                sourceNodeIndex: node.sourceNodeIndex,
                sourceMeshIndex: node.meshIndex,
                sourcePrimitiveIndex: primitive.sourcePrimitiveIndex,
            });
        }
    }
    return primitives;
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

function retainMaterial(gltfJson, material = {}) {
    const pbr = material.pbrMetallicRoughness || {};
    const textureIndex = pbr.baseColorTexture?.index;
    const texture = textureIndex != null ? gltfJson.textures?.[textureIndex] : null;
    const baseColorImageIndex = Number.isInteger(texture?.source) ? texture.source : -1;
    return {
        baseColor: [...(pbr.baseColorFactor || [1, 1, 1, 1])],
        emissive: [...(material.emissiveFactor || [0, 0, 0])],
        emissiveStrength: material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        baseColorImageIndex,
        alphaMode: material.alphaMode || 'OPAQUE',
        doubleSided: material.doubleSided === true,
    };
}

function nodeLocalMatrix(node, nodeIndex) {
    if (node.matrix != null) {
        if (!Array.isArray(node.matrix) || node.matrix.length !== 16 || !node.matrix.every(Number.isFinite)) {
            throw new Error(`Node ${nodeIndex} matrix must contain 16 finite values.`);
        }
        return new Float32Array(node.matrix);
    }
    try {
        return composeTRSMatrix(node.translation, node.rotation, node.scale);
    } catch (error) {
        throw new Error(`Node ${nodeIndex} has an invalid TRS transform: ${error.message}`);
    }
}

function requireTightAccessor(gltfJson, accessorIndex, label) {
    const accessor = gltfJson.accessors?.[accessorIndex];
    if (!accessor) throw new Error(`${label} references missing accessor ${accessorIndex}.`);
    if (accessor.sparse) throw new Error(`${label} uses a sparse accessor; sparse accessors are deferred to RT-010A.`);
    if (accessor.normalized) throw new Error(`${label} uses normalized integer data; normalized accessors are deferred to RT-010A.`);
    const bufferView = gltfJson.bufferViews?.[accessor.bufferView];
    if (!bufferView) throw new Error(`${label} references missing bufferView ${accessor.bufferView}.`);
    if (bufferView.buffer !== 0) throw new Error(`${label} uses buffer ${bufferView.buffer}; multiple buffers are deferred to RT-010A.`);
    if (bufferView.byteStride != null) throw new Error(`${label} uses byteStride; strided accessors are deferred to RT-010A.`);
    return { accessor, bufferView };
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

    // --- Buffers ---
    if (!gltfJson.buffers?.length) throw new Error('GLTF file does not contain a buffer.');
    if (gltfJson.buffers.length !== 1) {
        throw new Error('Multiple glTF buffers are deferred to RT-010A.');
    }
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

    const retainedMaterials = (gltfJson.materials || []).map((material) => retainMaterial(gltfJson, material));
    let defaultMaterialIndex = -1;
    const getMaterialIndex = (primitive, label) => {
        if (primitive.material == null) {
            if (defaultMaterialIndex < 0) {
                defaultMaterialIndex = retainedMaterials.length;
                retainedMaterials.push(defaultMaterial());
            }
            return defaultMaterialIndex;
        }
        if (!Number.isInteger(primitive.material) || !retainedMaterials[primitive.material]) {
            throw new Error(`${label} references missing material ${primitive.material}.`);
        }
        const textureIndex = gltfJson.materials[primitive.material]
            ?.pbrMetallicRoughness?.baseColorTexture?.index;
        if (textureIndex != null && !Number.isInteger(gltfJson.textures?.[textureIndex]?.source)) {
            throw new Error(`${label} references missing base-color texture ${textureIndex}.`);
        }
        if (retainedMaterials[primitive.material].alphaMode !== 'OPAQUE') {
            throw new Error(`${label} uses alpha mode ${retainedMaterials[primitive.material].alphaMode}; alpha materials are deferred to RT-010A.`);
        }
        return primitive.material;
    };

    const meshes = gltfJson.meshes.map((mesh) => ({ name: mesh.name || '', primitives: [] }));
    const parseMesh = (meshIndex) => {
        const retainedMesh = meshes[meshIndex];
        if (!retainedMesh) throw new Error(`Scene node references missing mesh ${meshIndex}.`);
        if (retainedMesh.primitives.length) return retainedMesh;
        const sourceMesh = gltfJson.meshes[meshIndex];
        if (!sourceMesh.primitives?.length) throw new Error(`Mesh ${meshIndex} does not contain primitives.`);
        retainedMesh.primitives = sourceMesh.primitives.map((primitive, primitiveIndex) => {
            const label = `Mesh ${meshIndex} primitive ${primitiveIndex}`;
            const mode = primitive.mode ?? 4;
            if (mode !== 4) throw new Error(`${label} uses unsupported mode ${mode}; only TRIANGLES (4) is supported.`);
            if (primitive.targets?.length) throw new Error(`${label} uses morph targets; morph targets are deferred to RT-010A.`);
            if (primitive.attributes?.POSITION == null) throw new Error(`${label} omits POSITION.`);
            if (primitive.attributes?.NORMAL == null) throw new Error(`${label} omits NORMAL; normal generation is deferred to RT-010A.`);
            if (primitive.indices == null) throw new Error(`${label} omits indices; generated indices are deferred to RT-010A.`);

            const position = requireTightAccessor(gltfJson, primitive.attributes.POSITION, `${label} POSITION`);
            const normal = requireTightAccessor(gltfJson, primitive.attributes.NORMAL, `${label} NORMAL`);
            const index = requireTightAccessor(gltfJson, primitive.indices, `${label} indices`);
            if (position.accessor.type !== 'VEC3' || position.accessor.componentType !== 5126) {
                throw new Error(`${label} POSITION must be a tightly packed FLOAT VEC3 accessor.`);
            }
            if (normal.accessor.type !== 'VEC3' || normal.accessor.componentType !== 5126) {
                throw new Error(`${label} NORMAL must be a tightly packed FLOAT VEC3 accessor.`);
            }
            if (index.accessor.type !== 'SCALAR' || ![5121, 5123, 5125].includes(index.accessor.componentType)) {
                throw new Error(`${label} indices must be an unsigned integer SCALAR accessor.`);
            }
            let texCoord = null;
            if (primitive.attributes.TEXCOORD_0 != null) {
                texCoord = requireTightAccessor(gltfJson, primitive.attributes.TEXCOORD_0, `${label} TEXCOORD_0`);
                if (texCoord.accessor.type !== 'VEC2' || texCoord.accessor.componentType !== 5126) {
                    throw new Error(`${label} TEXCOORD_0 must be a tightly packed FLOAT VEC2 accessor.`);
                }
            }

            const positions = getBufferViewData(binaryBufferData, position.bufferView, position.accessor);
            const normals = getBufferViewData(binaryBufferData, normal.bufferView, normal.accessor);
            const indices = getBufferViewData(binaryBufferData, index.bufferView, index.accessor);
            const texCoords = texCoord
                ? getBufferViewData(binaryBufferData, texCoord.bufferView, texCoord.accessor)
                : null;
            if (normals.length !== positions.length) throw new Error(`${label} NORMAL count must match POSITION count.`);
            if (texCoords && texCoords.length !== (positions.length / 3) * 2) {
                throw new Error(`${label} TEXCOORD_0 count must match POSITION count.`);
            }
            if (indices.length % 3 !== 0) throw new Error(`${label} index count must be a multiple of three.`);

            return {
                sourcePrimitiveIndex: primitiveIndex,
                mode,
                attributes: { POSITION: positions, NORMAL: normals, TEXCOORD_0: texCoords },
                positions,
                normals,
                texCoords,
                indices,
                indicesComponentType: index.accessor.componentType,
                materialIndex: getMaterialIndex(primitive, label),
            };
        });
        return retainedMesh;
    };

    const sourceNodes = gltfJson.nodes || [];
    const sourceScenes = gltfJson.scenes || [];
    const hasSceneGraph = sourceScenes.length > 0;
    const defaultSceneIndex = hasSceneGraph ? (gltfJson.scene ?? 0) : 0;
    if (hasSceneGraph && (!Number.isInteger(defaultSceneIndex) || !sourceScenes[defaultSceneIndex])) {
        throw new Error(`GLTF default scene index ${defaultSceneIndex} is out of range.`);
    }
    const selectedRoots = hasSceneGraph ? (sourceScenes[defaultSceneIndex].nodes || []) : [0];
    const nodes = [];
    const visited = new Set();
    const activePath = new Set();
    const visitNode = (nodeIndex, parentWorld) => {
        if (!Number.isInteger(nodeIndex) || !sourceNodes[nodeIndex]) throw new Error(`Scene references missing node ${nodeIndex}.`);
        if (activePath.has(nodeIndex)) throw new Error(`Cycle detected at glTF node ${nodeIndex}.`);
        if (visited.has(nodeIndex)) throw new Error(`glTF node ${nodeIndex} is referenced more than once in the selected scene.`);
        activePath.add(nodeIndex);
        visited.add(nodeIndex);
        const sourceNode = sourceNodes[nodeIndex];
        if (sourceNode.skin != null) throw new Error(`Node ${nodeIndex} uses a skin; skinning is deferred to RT-010A.`);
        const localMatrix = nodeLocalMatrix(sourceNode, nodeIndex);
        const worldMatrix = multiplyMatrices(parentWorld, localMatrix);
        const meshIndex = sourceNode.mesh ?? -1;
        if (!Number.isInteger(meshIndex) || meshIndex < -1) {
            throw new Error(`Node ${nodeIndex} mesh index must be a non-negative integer.`);
        }
        if (meshIndex >= 0) parseMesh(meshIndex);
        nodes.push({
            sourceNodeIndex: nodeIndex,
            name: sourceNode.name || '',
            children: [...(sourceNode.children || [])],
            localMatrix,
            worldMatrix,
            meshIndex,
        });
        for (const childIndex of sourceNode.children || []) visitNode(childIndex, worldMatrix);
        activePath.delete(nodeIndex);
    };

    if (hasSceneGraph) {
        for (const rootIndex of selectedRoots) visitNode(rootIndex, createIdentityMatrix());
    } else {
        parseMesh(0);
        nodes.push({
            sourceNodeIndex: 0,
            name: '',
            children: [],
            localMatrix: createIdentityMatrix(),
            worldMatrix: createIdentityMatrix(),
            meshIndex: 0,
        });
    }

    const usedImageIndices = new Set();
    for (const node of nodes) {
        if (node.meshIndex < 0) continue;
        for (const primitive of meshes[node.meshIndex].primitives) {
            const imageIndex = retainedMaterials[primitive.materialIndex].baseColorImageIndex;
            if (imageIndex >= 0) usedImageIndices.add(imageIndex);
        }
    }
    const images = new Array(gltfJson.images?.length || 0).fill(null);
    await Promise.all([...usedImageIndices].map(async (imageIndex) => {
        const imageSource = gltfJson.images?.[imageIndex];
        if (!imageSource) throw new Error(`Material references missing image ${imageIndex}.`);
        if (!imageSource.uri) throw new Error('Embedded GLTF images are deferred to RT-010A.');
        const imagePath = baseUrl + imageSource.uri;
        const localImageFile = resolveLocalFile(localFileMap, imagePath);
        if (localImageFile) {
            images[imageIndex] = await createImageBitmap(localImageFile);
            return;
        }
        if (!baseUrl) {
            throw new Error(`Cannot resolve image URI: ${imageSource.uri}. baseUrl=(empty); available files (sample): ${listAvailableFiles().join(', ')}`);
        }
        const imageResponse = await fetch(imagePath);
        if (!imageResponse.ok) {
            throw new Error(`Failed to load texture from ${imagePath}: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        images[imageIndex] = await createImageBitmap(await imageResponse.blob());
    }));

    const asset = {
        sourceName,
        scenes: hasSceneGraph
            ? sourceScenes.map((scene) => ({ rootNodeIndices: [...(scene.nodes || [])] }))
            : [{ rootNodeIndices: [0] }],
        defaultSceneIndex,
        nodes,
        meshes,
        materials: retainedMaterials,
        images,
    };
    asset.rasterPrimitives = assetToRasterPrimitives(asset);
    if (!asset.rasterPrimitives.length) throw new Error('Selected glTF scene does not contain triangle primitives.');
    asset.rayScene = assetToRayScene(asset);
    asset.bounds = asset.rayScene.bounds;

    // Legacy aliases keep existing single-primitive upload paths working until RT-010B.
    const firstPrimitive = asset.rasterPrimitives[0];
    asset.positions = firstPrimitive.positions;
    asset.normals = firstPrimitive.normals;
    asset.texCoords = firstPrimitive.texCoords;
    asset.indices = firstPrimitive.indices;
    asset.indicesComponentType = firstPrimitive.indicesComponentType;
    asset.material = firstPrimitive.material;
    asset.textureBitmap = firstPrimitive.textureBitmap;
    return asset;
}
