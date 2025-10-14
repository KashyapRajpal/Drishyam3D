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
 * Parses a GLTF file and prepares it for rendering.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {ArrayBuffer} gltfData The raw GLTF file data.
 * @returns {Promise<{buffers: object, vertexCount: number}>} A drawable object for the scene.
 */
export async function parseGltf(gl, gltfData) {
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
    const indicesAccessor = primitive.indices;

    if (!positionAccessor || !normalAccessor || !indicesAccessor) {
        throw new Error("Mesh is missing required attributes (POSITION, NORMAL, or indices).");
    }

    const positions = await gltf.getBufferView(positionAccessor.bufferView);
    const normals = await gltf.getBufferView(normalAccessor.bufferView);
    const indices = await gltf.getBufferView(indicesAccessor.bufferView);

    // Create WebGL buffers
    const positionBuffer = createAndBindBuffer(gl, gl.ARRAY_BUFFER, positions);
    const normalBuffer = createAndBindBuffer(gl, gl.ARRAY_BUFFER, normals);
    const indexBuffer = createAndBindBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices);

    const drawable = {
        buffers: {
            position: positionBuffer,
            normal: normalBuffer,
            indices: indexBuffer,
        },
        vertexCount: indicesAccessor.count,
    };

    console.log("GLTF model parsed successfully:", drawable);
    return drawable;
}