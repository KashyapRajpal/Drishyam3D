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
function getWebGLComponentType(componentType) {
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
function getBufferViewData(bufferData, bufferView, accessor) {
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

    if (typeof source === 'string') {
        // Assume source is a URL to a .gltf file
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Failed to fetch GLTF from ${source}: ${response.statusText}`);
        gltfJson = await response.json();
        baseUrl = source.substring(0, source.lastIndexOf('/') + 1);
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
            throw new Error(`Cannot resolve buffer URI: ${buffer.uri}. Make sure all required files are selected.`);
        }
    } else {
        throw new Error("Embedded GLTF buffers are not yet supported by this simple loader.");
    }

    const bufferViews = gltfJson.bufferViews;

    const positions = getBufferViewData(binaryBufferData, bufferViews[positionAccessor.bufferView], positionAccessor);
    const normals = getBufferViewData(binaryBufferData, bufferViews[normalAccessor.bufferView], normalAccessor);
    const indices = getBufferViewData(binaryBufferData, bufferViews[indicesAccessor.bufferView], indicesAccessor);

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
                throw new Error(`Cannot resolve image URI: ${imageSource.uri}. Make sure all required files are selected.`);
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

    const drawable = {
        buffers: buffers,
        texture: texture,
        vertexCount: indicesAccessor.count,
        indexType: getWebGLComponentType(indicesAccessor.componentType), // Use the WebGL constant
    };

    console.log("GLTF model parsed successfully:", drawable);
    return drawable;
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}