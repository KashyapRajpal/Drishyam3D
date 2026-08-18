/**
 * @file A simple GLTF model parser.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { composeTRSMatrix, createIdentityMatrix, multiplyMatrices } from './matrix.js';
import { createSequentialIndices, decodeGltfAccessor } from './gltf-accessors.js';
import { parseGltfContainer } from './gltf-container.js';
import { generateVertexNormals } from './gltf-geometry.js';
import { prepareRayScene } from './raytracing/core/ray-scene.js';
import { uploadGltfWebGL, uploadGltfWebGPU } from './gltf-upload.js';

export { getWebGLComponentType } from './gltf-upload.js';

// This loader intentionally targets static glTF 2.0 triangle scenes. Unsupported
// animation/deformation/compression features fail by name instead of being ignored.


/**
 * Extracts typed array data from a GLTF buffer view.
 * @param {ArrayBuffer} bufferData The raw binary buffer data.
 * @param {object} bufferView The GLTF bufferView object.
 * @param {object} accessor The GLTF accessor object.
 * @returns {TypedArray} The extracted typed array.
 */
export function getBufferViewData(bufferData, bufferView, accessor) {
    return decodeGltfAccessor(
        { bufferViews: [{ ...bufferView, buffer: 0 }], accessors: [{ ...accessor, bufferView: 0 }] },
        [bufferData],
        0,
    ).data;
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

async function loadGltfBuffers(gltf, binaryChunk, baseUrl, localFileMap, listAvailableFiles) {
    if (!gltf.buffers?.length) throw new Error('GLTF file does not contain a buffer.');
    let claimedBinaryChunk = false;
    return Promise.all(gltf.buffers.map(async (buffer, bufferIndex) => {
        if (!Number.isInteger(buffer.byteLength) || buffer.byteLength < 0) {
            throw new Error(`Buffer ${bufferIndex} byteLength must be a non-negative integer.`);
        }
        let data;
        if (buffer.uri != null) {
            if (typeof buffer.uri !== 'string' || buffer.uri.startsWith('data:')) {
                throw new Error(`Buffer ${bufferIndex} uses an embedded data URI, which is not supported.`);
            }
            const bufferPath = baseUrl + buffer.uri;
            const localFile = resolveLocalFile(localFileMap, bufferPath);
            if (localFile) {
                data = await localFile.arrayBuffer();
            } else if (baseUrl) {
                const response = await fetch(bufferPath);
                if (!response.ok) throw new Error(`Failed to fetch binary buffer from ${bufferPath}`);
                data = await response.arrayBuffer();
            } else {
                throw new Error(`Cannot resolve buffer URI: ${buffer.uri}. baseUrl=(empty); available files (sample): ${listAvailableFiles().join(', ')}`);
            }
        } else {
            if (!binaryChunk) throw new Error(`Buffer ${bufferIndex} has no URI and no GLB BIN chunk.`);
            if (claimedBinaryChunk) throw new Error('Only one glTF buffer may reference the GLB BIN chunk.');
            claimedBinaryChunk = true;
            data = binaryChunk;
        }
        if (!(data instanceof ArrayBuffer) || data.byteLength < buffer.byteLength) {
            throw new Error(`Buffer ${bufferIndex} has ${data?.byteLength ?? 'invalid'} bytes; expected at least ${buffer.byteLength}.`);
        }
        return data;
    }));
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

/**
 * Parses GLTF into backend-agnostic typed arrays and optional texture bitmap.
 * @param {ArrayBuffer | string | FileList | Map<string, File>} source
 * @returns {Promise<object>}
 */
export async function parseGltfAsset(source) {
    let gltfJson;
    let binaryChunk = null;
    let baseUrl = '';
    const localFileMap = new Map();
    let sourceName = 'gltf';

    function listAvailableFiles(limit = 10) {
        const keys = Array.from(localFileMap.keys());
        return keys.slice(0, limit);
    }

    if (typeof source === 'string') {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Failed to fetch GLTF from ${source}: ${response.statusText}`);
        ({ json: gltfJson, binaryChunk } = parseGltfContainer(
            await response.arrayBuffer(),
            { expectGlb: /\.glb(?:$|[?#])/i.test(source) },
        ));
        baseUrl = source.substring(0, source.lastIndexOf('/') + 1);
        const urlParts = source.split('/');
        const fileName = urlParts[urlParts.length - 1] || '';
        sourceName = fileName.replace(/\.[^/.]+$/, '') || 'gltf';
    } else if ((typeof FileList !== 'undefined' && source instanceof FileList) || source instanceof Map) {
        if (source instanceof Map) {
            source.forEach((value, key) => localFileMap.set(key, value));
        } else {
            for (const selectedFile of source) {
                localFileMap.set(selectedFile.webkitRelativePath || selectedFile.name, selectedFile);
            }
        }
        const mainFilePath = [...localFileMap.keys()].find((path) => /\.(gltf|glb)$/i.test(path));
        if (!mainFilePath) throw new Error("No .gltf or .glb file found in selection.");
        const mainFile = localFileMap.get(mainFilePath);

        // Determine the base path from the main GLTF file's location
        const lastSlash = mainFilePath.lastIndexOf('/');
        if (lastSlash > -1) {
            baseUrl = mainFilePath.substring(0, lastSlash + 1);
        }

        ({ json: gltfJson, binaryChunk } = parseGltfContainer(
            await mainFile.arrayBuffer(),
            { expectGlb: /\.glb$/i.test(mainFilePath) },
        ));

        const mainFileName = mainFilePath.split('/').pop() || mainFilePath;
        sourceName = mainFileName.replace(/\.[^/.]+$/, '') || 'gltf';

    } else if (source instanceof ArrayBuffer) {
        ({ json: gltfJson, binaryChunk } = parseGltfContainer(source));
    } else {
        throw new Error("Unsupported GLTF source type. Must be a URL, ArrayBuffer, FileList, or file Map.");
    }

    if (gltfJson?.asset?.version !== '2.0') throw new Error(`Unsupported glTF version ${gltfJson?.asset?.version || '(missing)'}; expected 2.0.`);
    const extensions = new Set(gltfJson.extensionsUsed || []);
    if (extensions.has('KHR_draco_mesh_compression')) {
        throw new Error('KHR_draco_mesh_compression is not supported; provide uncompressed mesh data.');
    }
    if (extensions.has('EXT_meshopt_compression')) {
        throw new Error('EXT_meshopt_compression is not supported; provide uncompressed mesh data.');
    }
    if (gltfJson.bufferViews?.some((view) => view.extensions?.EXT_meshopt_compression)) {
        throw new Error('EXT_meshopt_compression is not supported; provide uncompressed mesh data.');
    }
    if (!gltfJson || !gltfJson.meshes || gltfJson.meshes.length === 0) {
        throw new Error("GLTF file does not contain any meshes.");
    }

    const bufferData = await loadGltfBuffers(gltfJson, binaryChunk, baseUrl, localFileMap, listAvailableFiles);

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
            throw new Error(`${label} uses unsupported alpha mode ${retainedMaterials[primitive.material].alphaMode}.`);
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
            if (primitive.extensions?.KHR_draco_mesh_compression) {
                throw new Error(`${label} uses KHR_draco_mesh_compression, which is not supported.`);
            }
            if (primitive.targets?.length) throw new Error(`${label} uses morph targets, which are not supported.`);
            if (primitive.attributes?.POSITION == null) throw new Error(`${label} omits POSITION.`);

            const position = decodeGltfAccessor(
                gltfJson,
                bufferData,
                primitive.attributes.POSITION,
                `${label} POSITION`,
            );
            if (position.type !== 'VEC3' || position.componentType !== 5126) {
                throw new Error(`${label} POSITION must be a FLOAT VEC3 accessor.`);
            }
            const positions = position.data;

            let indices;
            let indicesComponentType;
            if (primitive.indices == null) {
                indices = createSequentialIndices(position.count);
                indicesComponentType = indices instanceof Uint32Array ? 5125 : 5123;
            } else {
                const index = decodeGltfAccessor(gltfJson, bufferData, primitive.indices, `${label} indices`);
                if (index.type !== 'SCALAR' || ![5121, 5123, 5125].includes(index.componentType) || index.normalized) {
                    throw new Error(`${label} indices must be an unnormalized unsigned integer SCALAR accessor.`);
                }
                indices = index.data;
                indicesComponentType = index.componentType;
            }
            if (indices.length % 3 !== 0) throw new Error(`${label} index count must be a multiple of three.`);
            for (let index = 0; index < indices.length; index += 1) {
                if (indices[index] >= position.count) throw new Error(`${label} index ${index} is out of range.`);
            }

            let normals;
            if (primitive.attributes.NORMAL == null) {
                normals = generateVertexNormals(positions, indices);
            } else {
                const normal = decodeGltfAccessor(
                    gltfJson,
                    bufferData,
                    primitive.attributes.NORMAL,
                    `${label} NORMAL`,
                );
                const supportedNormal = normal.componentType === 5126
                    || (normal.normalized && [5120, 5122].includes(normal.componentType));
                if (normal.type !== 'VEC3' || !supportedNormal || !(normal.data instanceof Float32Array)) {
                    throw new Error(`${label} NORMAL must be FLOAT or normalized signed-integer VEC3 data.`);
                }
                normals = normal.data;
                if (normal.count !== position.count) throw new Error(`${label} NORMAL count must match POSITION count.`);
            }

            let texCoords = null;
            if (primitive.attributes.TEXCOORD_0 != null) {
                const texCoord = decodeGltfAccessor(
                    gltfJson,
                    bufferData,
                    primitive.attributes.TEXCOORD_0,
                    `${label} TEXCOORD_0`,
                );
                const supportedTexCoord = texCoord.componentType === 5126
                    || (texCoord.normalized && [5121, 5123].includes(texCoord.componentType));
                if (texCoord.type !== 'VEC2' || !supportedTexCoord || !(texCoord.data instanceof Float32Array)) {
                    throw new Error(`${label} TEXCOORD_0 must be FLOAT or normalized unsigned-integer VEC2 data.`);
                }
                if (texCoord.count !== position.count) throw new Error(`${label} TEXCOORD_0 count must match POSITION count.`);
                texCoords = texCoord.data;
            }

            return {
                sourcePrimitiveIndex: primitiveIndex,
                mode,
                attributes: { POSITION: positions, NORMAL: normals, TEXCOORD_0: texCoords },
                positions,
                normals,
                texCoords,
                indices,
                indicesComponentType,
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
        if (sourceNode.skin != null) throw new Error(`Node ${nodeIndex} uses unsupported skinning.`);
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
        if (!imageSource.uri) throw new Error('Embedded glTF images are not supported.');
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
