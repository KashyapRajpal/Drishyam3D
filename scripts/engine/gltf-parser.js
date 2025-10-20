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
 * Parses a GLTF file and prepares it for rendering.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ArrayBuffer} gltfData The raw GLTF file data.
 * @returns {Promise<{buffers: object, vertexCount: number}>} A drawable object for the scene.
 */
export async function parseGltf(gl, gltfData) {
    if (typeof GltfLoader === 'undefined') {
        throw new Error("GltfLoader library is not available. Check if the script has loaded.");
    }

    const loader = new GltfLoader.GltfLoader();
    const asset = new GltfLoader.GltfAsset(gltfData);
    const gltf = await loader.load(asset);

    if (!gltf || !gltf.meshes || gltf.meshes.length === 0) {
        throw new Error("GLTF file does not contain any meshes.");
    }

    // For simplicity, we'll load the first primitive of the first mesh.
    const mesh = gltf.meshes[0];
    const primitive = mesh.primitives[0];

    // Get accessor data for positions, normals, and indices
    const positionAccessor = primitive.attributes.POSITION;
    const normalAccessor = primitive.attributes.NORMAL;
    const texCoordAccessor = primitive.attributes.TEXCOORD_0;
    const indicesAccessor = primitive.indices;

    if (!positionAccessor || !normalAccessor || !indicesAccessor) {
        throw new Error("Mesh is missing required attributes (POSITION, NORMAL, or indices).");
    }

    // --- Buffers ---
    const positions = await gltf.getBufferView(positionAccessor.bufferView);
    const normals = await gltf.getBufferView(normalAccessor.bufferView);
    const indices = await gltf.getBufferView(indicesAccessor.bufferView);

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
        const texCoords = await gltf.getBufferView(texCoordAccessor.bufferView);
        buffers.texCoord = createAndBindBuffer(gl, gl.ARRAY_BUFFER, texCoords);
    }

    // --- Texture (if it exists) ---
    let texture = null;
    const material = gltf.materials[primitive.material];
    if (material && material.pbrMetallicRoughness && material.pbrMetallicRoughness.baseColorTexture) {
        const textureInfo = material.pbrMetallicRoughness.baseColorTexture;
        const textureSource = gltf.textures[textureInfo.index].source;
        const image = await gltf.images[textureSource.index].getImage();
        texture = createAndBindTexture(gl, image);
    }

    const drawable = {
        buffers: buffers,
        texture: texture,
        vertexCount: indicesAccessor.count,
    };

    console.log("GLTF model parsed successfully:", drawable);
    return drawable;
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}