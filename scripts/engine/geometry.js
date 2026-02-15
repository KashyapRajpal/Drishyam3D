/**
 * @file Contains functions for creating and managing geometric shapes and textures.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { assetVersions } from '../../assets/asset-manifest.js';

export function initCubeBuffers(gl) {
    // Create a buffer for the cube's vertex positions.
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
        // Front face
        -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
        // Back face
        -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0,
        // Top face
        -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0,
        // Bottom face
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
        // Right face
        1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0,
        // Left face
        -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create a buffer for the cube's texture coordinates.
    const textureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    const textureCoordinates = [
        // Front
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
        // Back
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
        // Top
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
        // Bottom
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
        // Right
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
        // Left
        0.0,  0.0,  1.0,  0.0,  1.0,  1.0,  0.0,  1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

    // Create a buffer for the cube's normals.
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    const vertexNormals = [
        // Front
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
        // Back
        0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0,
        // Top
        0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0,
        // Bottom
        0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0,
        // Right
        1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0,
        // Left
        -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexNormals), gl.STATIC_DRAW);

    // Create a buffer for the cube's indices.
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    const cubeVertexIndices = [
        0, 1, 2, 0, 2, 3, // front
        4, 5, 6, 4, 6, 7, // back
        8, 9, 10, 8, 10, 11, // top
        12, 13, 14, 12, 14, 15, // bottom
        16, 17, 18, 16, 18, 19, // right
        20, 21, 22, 20, 22, 23, // left
    ];
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cubeVertexIndices), gl.STATIC_DRAW);

    return {
        position: positionBuffer,
        normal: normalBuffer,
        texCoord: textureCoordBuffer,
        indices: indexBuffer,
    };
}

function loadTexture(gl, url) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Start with a 1x1 blue pixel while the image loads
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixel);

    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = function() {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, srcFormat, srcType, image);
            if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
                gl.generateMipmap(gl.TEXTURE_2D);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            resolve(texture);
        };
        image.onerror = (err) => {
            reject(new Error(`Failed to load texture: ${url}`));
        };
        image.src = url;
    });
}

function isPowerOf2(value) {
    return (value & (value - 1)) === 0;
}

function resolveTextureUrl() {
    const manifestKey = '../assets/checkerboard-texture.png';
    // Default to manifest key (works in original app when __DRISHYAM_ASSET is present)
    let baseUrl = manifestKey;

    function getImportMetaUrl() {
        try {
            return new Function('return import.meta.url')();
        } catch (e) {
            return null;
        }
    }

    if (typeof window !== 'undefined' && typeof window.__DRISHYAM_ASSET === 'function') {
        baseUrl = window.__DRISHYAM_ASSET('assets/checkerboard-texture.png');
    } else {
        // Vite/ESM friendly resolution (guarded for non-ESM/Jest)
        try {
            const metaUrl = getImportMetaUrl();
            if (metaUrl) {
                baseUrl = new URL('../../assets/checkerboard-texture.png', metaUrl).toString();
            }
        } catch (e) {
            // Keep fallback
        }
    }

    return { baseUrl, manifestKey };
}

/**
 * Creates the default cube drawable object for the scene.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @returns {{buffers: object, texture: null, vertexCount: number}}
 */
export function createDefaultCube(gl) {
    return {
        buffers: initCubeBuffers(gl),
        texture: null, // Explicitly untextured
        vertexCount: 36,
        indexType: gl.UNSIGNED_SHORT, // Our cube uses Uint16Array
        _debug: {
            name: 'cube',
        },
    };
}

/**
 * Creates the default textured cube drawable object for the scene.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @returns {Promise<{buffers: object, texture: WebGLTexture, vertexCount: number}>}
 */
export async function createDefaultTexturedCube(gl) {
    try {
        const { baseUrl, manifestKey } = resolveTextureUrl();
        const version = assetVersions[manifestKey];
        let textureUrl;

        if (version) {
            textureUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${version}`;
        } else {
            console.warn(`No version found for ${manifestKey}. Falling back to timestamp.`);
            textureUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${new Date().getTime()}`;
        }

        const texture = await loadTexture(gl, textureUrl);
        return {
            buffers: initCubeBuffers(gl),
            texture: texture,
            vertexCount: 36,
            indexType: gl.UNSIGNED_SHORT,
            _debug: {
                name: 'textured cube',
            },
        };
    } catch (error) {
        console.error("Could not create default textured cube:", error);
        // Fallback to an untextured cube if texture loading fails
        return createDefaultCube(gl);
    }
}

/**
 * Creates a textured sphere drawable object.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @returns {Promise<{buffers: object, texture: WebGLTexture, vertexCount: number}>}
 */
export async function createTexturedSphere(gl) {
    try {
        const { baseUrl, manifestKey } = resolveTextureUrl();
        const version = assetVersions[manifestKey];
        let textureUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${new Date().getTime()}`;

        if (version) {
            textureUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${version}`;
        } else {
            console.warn(`No version found for ${manifestKey}. Falling back to timestamp.`);
        }

        const texture = await loadTexture(gl, textureUrl);
        const sphereGeometry = createSphere(gl); // Re-use the sphere creation logic

        sphereGeometry.texture = texture; // Attach the loaded texture
        sphereGeometry._debug = {
            ...(sphereGeometry._debug || {}),
            name: 'textured sphere',
        };
        return sphereGeometry;
    } catch (error) {
        console.error("Could not create default textured sphere:", error);
        return createSphere(gl); // Fallback to untextured sphere
    }
}

/**
 * Creates a sphere drawable object.
 * @param {WebGLRenderingContext} gl The WebGL context.
 * @param {number} [radius=1] The radius of the sphere.
 * @param {number} [latitudeBands=30] The number of horizontal bands.
 * @param {number} [longitudeBands=30] The number of vertical bands.
 * @returns {{buffers: object, texture: null, vertexCount: number}}
 */
export function createSphere(gl, radius = 1, latitudeBands = 30, longitudeBands = 30) {
    const vertexPositionData = [];
    const normalData = [];
    const textureCoordData = [];

    for (let latNumber = 0; latNumber <= latitudeBands; latNumber++) {
        const theta = latNumber * Math.PI / latitudeBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let longNumber = 0; longNumber <= longitudeBands; longNumber++) {
            const phi = longNumber * 2 * Math.PI / longitudeBands;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            const u = 1 - (longNumber / longitudeBands);
            const v = 1 - (latNumber / latitudeBands);

            normalData.push(x, y, z);
            textureCoordData.push(u, v);
            vertexPositionData.push(radius * x, radius * y, radius * z);
        }
    }

    const indexData = [];
    for (let latNumber = 0; latNumber < latitudeBands; latNumber++) {
        for (let longNumber = 0; longNumber < longitudeBands; longNumber++) {
            const first = (latNumber * (longitudeBands + 1)) + longNumber;
            const second = first + longitudeBands + 1;
            indexData.push(first, second, first + 1);
            indexData.push(second, second + 1, first + 1);
        }
    }

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normalData), gl.STATIC_DRAW);

    const textureCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordData), gl.STATIC_DRAW);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexPositionData), gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indexData), gl.STATIC_DRAW);

    return {
        buffers: {
            position: positionBuffer,
            normal: normalBuffer,
            texCoord: textureCoordBuffer,
            indices: indexBuffer,
        },
        texture: null,
        vertexCount: indexData.length,
        indexType: gl.UNSIGNED_SHORT, // Our sphere uses Uint16Array
        _debug: {
            name: 'sphere',
        },
    };
}