/**
 * @file A simple GLTF model parser.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

// This is a simplified GLTF loader designed to handle basic GLTF 2.0 files,
// particularly those with a single external .bin file and external textures,
// like the Khronos BoxTextured sample. It does not implement the full GLTF spec.


/**
 * Creates a WebGL buffer and uploads data to it.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {number} target The buffer target (e.g., gl.ARRAY_BUFFER).
 * @param {BufferSource} data The data to upload.
 * @returns {WebGLBuffer} The created buffer.
 */
function createAndBindBuffer(gl, target, data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
}

/**
 * Creates a WebGL texture from image data.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ImageBitmap} image The image data.
 * @returns {WebGLTexture} The created texture.
 */
function createAndBindTexture(gl, image) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // WebGL1 requires power-of-2 images for mipmapping, so we disable it
    // if the image dimensions are not powers of two.
    if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
    } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return texture;
}

/**
 * Converts a GLTF component type (e.g., 5123 for UNSIGNED_SHORT) to a WebGL constant.
 * @param {number} componentType The GLTF component type.
 * @returns {number} The corresponding WebGL constant.
 */
export function getWebGLComponentType(componentType) {
    switch (componentType) {
        case 5120: return WebGLRenderingContext.BYTE;
        case 5121: return WebGLRenderingContext.UNSIGNED_BYTE;
        case 5122: return WebGLRenderingContext.SHORT;
        case 5123: return WebGLRenderingContext.UNSIGNED_SHORT;
        case 5125: return WebGLRenderingContext.UNSIGNED_INT;
        case 5126: return WebGLRenderingContext.FLOAT;
        default: throw new Error(`Unsupported GLTF component type: ${componentType}`);
    }
}

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

// Extend WebGLRenderingContext to include sizeOf for component types
if (!WebGLRenderingContext.sizeOf) {
    WebGLRenderingContext.sizeOf = function(type) {
        switch (type) {
            case WebGLRenderingContext.BYTE:
            case WebGLRenderingContext.UNSIGNED_BYTE: return 1;
            case WebGLRenderingContext.SHORT:
            case WebGLRenderingContext.UNSIGNED_SHORT: return 2;
            case WebGLRenderingContext.INT:
            case WebGLRenderingContext.UNSIGNED_INT:
            case WebGLRenderingContext.FLOAT: return 4;
            default: return 0;
        }
    };
}

/**
 * Parses a GLTF file and prepares it for rendering.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ArrayBuffer | string | FileList | Map<string, File>} source The raw GLTF file data as an ArrayBuffer, a URL, a FileList, or a Map of file paths to File objects.
 * @returns {Promise<{buffers: object, vertexCount: number}>} A drawable object for the scene.
 */
export async function parseGltf(gl, source) {
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
    } else if (source instanceof FileList || source instanceof Map) {
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

    // Get accessor data for positions, normals, and indices
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
        const localBinFile = localFileMap.get(bufferPath);
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
    let indices = getBufferViewData(binaryBufferData, bufferViews[indicesAccessor.bufferView], indicesAccessor);

    // Handle 32-bit indices for WebGL1
    let indexType = getWebGLComponentType(indicesAccessor.componentType);
    if (indicesAccessor.componentType === 5125) { // UNSIGNED_INT
        const ext = gl.getExtension('OES_element_index_uint');
        if (!ext) {
            let maxIndex = 0;
            for (let i = 0; i < indices.length; i += 1) {
                if (indices[i] > maxIndex) maxIndex = indices[i];
            }
            if (maxIndex <= 65535) {
                indices = new Uint16Array(indices);
                indexType = WebGLRenderingContext.UNSIGNED_SHORT;
            } else {
                throw new Error('Model uses 32-bit indices not supported by this device.');
            }
        }
    }

    const positionBuffer = createAndBindBuffer(gl, gl.ARRAY_BUFFER, positions);
    const normalBuffer = createAndBindBuffer(gl, gl.ARRAY_BUFFER, normals);
    const indexBuffer = createAndBindBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices);
    
    const buffers = {
        position: positionBuffer,
        normal: normalBuffer,
        indices: indexBuffer,
    };

    // --- Texture Coordinates (if they exist) ---
    if (texCoordAccessor) {
        const texCoords = getBufferViewData(binaryBufferData, bufferViews[texCoordAccessor.bufferView], texCoordAccessor);
        buffers.texCoord = createAndBindBuffer(gl, gl.ARRAY_BUFFER, texCoords);
    }

    // --- Texture (if it exists) ---
    let texture = null;
    const material = gltfJson.materials[primitive.material];
    if (material && material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorTexture) {
        const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
        const gltfTexture = gltfJson.textures[textureInfo.index];
        const imageSource = gltfJson.images[gltfTexture.source];
        
        if (imageSource.uri) {
            let imageUrl;
            const imagePath = baseUrl + imageSource.uri;
            const localImageFile = localFileMap.get(imagePath);
            if (localImageFile) {
                imageUrl = URL.createObjectURL(localImageFile);
            } else if (baseUrl) {
                imageUrl = baseUrl + imageSource.uri;
            } else {
                throw new Error(`Cannot resolve image URI: ${imageSource.uri}. baseUrl=${baseUrl || '(empty)'}; available files (sample): ${listAvailableFiles().join(', ')}`);
            }

            const image = new Image();
            image.crossOrigin = "anonymous"; // Request the image with CORS headers
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error(`Failed to load texture from ${image.src}`));
                image.src = imageUrl;
            });
            texture = createAndBindTexture(gl, image);
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

    const drawable = {
        buffers: buffers,
        texture: texture,
        vertexCount: indicesAccessor.count,
        indexType: indexType, // Use resolved index type (handles 32-bit indices)
        bounds: { center, radius },
    };

    // Attach some diagnostic counts so the renderer can inspect buffer sizes.
    // These are element counts (not byte lengths).
    drawable._debug = {
        name: sourceName,
        positionElementCount: positions.length,
        normalElementCount: normals.length,
        indexElementCount: indices.length,
    };

    console.log("GLTF model parsed successfully:", drawable, drawable._debug);
    return drawable;
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}