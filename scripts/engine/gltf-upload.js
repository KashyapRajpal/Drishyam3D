import { createIndexBuffer, createTextureFromImageBitmap, createVertexBuffer } from './webgpu-helpers.js';

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function createWebGLBuffer(gl, target, data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
}

function createWebGLTexture(gl, image) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
    } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return texture;
}

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

export function uploadGltfWebGL(gl, asset) {
    let indices = asset.indices;
    let indexType = getWebGLComponentType(asset.indicesComponentType);
    if (asset.indicesComponentType === 5125 && !gl.getExtension('OES_element_index_uint')) {
        let maxIndex = 0;
        for (let i = 0; i < indices.length; i += 1) maxIndex = Math.max(maxIndex, indices[i]);
        if (maxIndex > 65535) throw new Error('Model uses 32-bit indices not supported by this device.');
        indices = new Uint16Array(indices);
        indexType = WebGLRenderingContext.UNSIGNED_SHORT;
    }
    const buffers = {
        position: createWebGLBuffer(gl, gl.ARRAY_BUFFER, asset.positions),
        normal: createWebGLBuffer(gl, gl.ARRAY_BUFFER, asset.normals),
        indices: createWebGLBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices),
    };
    if (asset.texCoords) buffers.texCoord = createWebGLBuffer(gl, gl.ARRAY_BUFFER, asset.texCoords);
    return {
        buffers,
        texture: asset.textureBitmap ? createWebGLTexture(gl, asset.textureBitmap) : null,
        vertexCount: indices.length,
        indexType,
        bounds: asset.bounds,
        rayTracing: { asset, preparedRayScene: asset.rayScene },
        _debug: {
            name: asset.sourceName,
            positionElementCount: asset.positions.length,
            normalElementCount: asset.normals.length,
            indexElementCount: indices.length,
        },
    };
}

export function uploadGltfWebGPU(device, asset) {
    let indices = asset.indices;
    if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
        indices = new Uint16Array(indices);
    }
    const indexFormat = indices instanceof Uint32Array ? 'uint32' : 'uint16';
    const indexCount = indices.length;
    let uploadIndices = indices;
    if (indices.byteLength % 4 !== 0) {
        uploadIndices = new Uint16Array(indices.length + 1);
        uploadIndices.set(indices);
    }
    const texCoords = asset.texCoords || new Float32Array((asset.positions.length / 3) * 2);
    return {
        kind: 'mesh',
        buffers: {
            position: createVertexBuffer(device, asset.positions),
            normal: createVertexBuffer(device, asset.normals),
            texCoord: createVertexBuffer(device, texCoords),
            indices: createIndexBuffer(device, uploadIndices),
        },
        texture: asset.textureBitmap ? createTextureFromImageBitmap(device, asset.textureBitmap) : null,
        vertexCount: indexCount,
        indexFormat,
        bounds: asset.bounds,
        rayTracing: { asset, preparedRayScene: asset.rayScene },
        _debug: {
            name: asset.sourceName,
            positionElementCount: asset.positions.length,
            normalElementCount: asset.normals.length,
            indexElementCount: indexCount,
        },
    };
}
