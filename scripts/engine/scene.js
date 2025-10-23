/**
 * @file Manages the WebGL scene, rendering loop, and drawable objects.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix, createPerspectiveMatrix } from './matrix.js';

function resizeCanvas(canvas) {
    const displayWidth  = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width  !== displayWidth || canvas.height !== displayHeight) {
      canvas.width  = displayWidth;
      canvas.height = displayHeight;
    }
}

export function createScene(gl, canvas) {
    // Create a 1x1 white texture to use for models without textures
    const defaultTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, defaultTexture);
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([255, 255, 255, 255]);  // opaque white
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixel);

    let drawable = null; // Will hold { buffers, vertexCount }

    let programInfo = null;
    let userScript = {
        init: () => {},
        update: () => {}
    };

    const sceneState = {
        modelRotation: 0.0,
        modelViewMatrix: null,
    };

    let then = 0;

    function render(now) {
        now *= 0.001; // Convert to seconds
        const deltaTime = now - then;
        then = now;

        // Exit if we don't have a drawable object or a shader program
        if (!programInfo || !drawable) {
            requestAnimationFrame(render);
            return;
        }

        resizeCanvas(canvas);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const fieldOfView = 45 * Math.PI / 180;
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar);

        const modelViewMatrix = createIdentityMatrix();
        sceneState.modelViewMatrix = modelViewMatrix;

        userScript.update(sceneState, deltaTime);

        // Set vertex attributes
        {
            const numComponents = 3;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffers.position);
            gl.vertexAttribPointer(
                programInfo.attribLocations.vertexPosition,
                numComponents, type, normalize, stride, offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
        }

        // Set normal attributes
        {
            const numComponents = 3;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffers.normal);
            gl.vertexAttribPointer(
                programInfo.attribLocations.vertexNormal,
                numComponents, type, normalize, stride, offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);
        }

        // Set texture coordinate attribute
        if (programInfo.attribLocations.textureCoord !== -1 && drawable.buffers.texCoord) {
            const numComponents = 2;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffers.texCoord);
            gl.vertexAttribPointer(
                programInfo.attribLocations.textureCoord,
                numComponents, type, normalize, stride, offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);
        } else if (programInfo.attribLocations.textureCoord !== -1) {
            // If the shader has the attribute but the model doesn't, disable it.
            gl.disableVertexAttribArray(programInfo.attribLocations.textureCoord);
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, drawable.buffers.indices);
        gl.useProgram(programInfo.program);

        gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);

        // Set texture and base color uniforms
        const hasTexture = !!drawable.texture;
        gl.uniform1i(programInfo.uniformLocations.uHasTexture, hasTexture);

        // Tell WebGL we want to affect texture unit 0
        gl.activeTexture(gl.TEXTURE0);
        // Bind the texture or the default white texture
        gl.bindTexture(gl.TEXTURE_2D, drawable.texture || defaultTexture);
        // Tell the shader we bound the texture to texture unit 0
        gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

        // Set a default base color (blue for untextured, white for textured)
        gl.uniform4fv(programInfo.uniformLocations.uBaseColor, hasTexture ? [1, 1, 1, 1] : [0.5, 0.5, 1.0, 1.0]);

        {
            const vertexCount = drawable.vertexCount;
            const type = drawable.indexType; // Use the type from the drawable object
            const offset = 0;
            gl.drawElements(gl.TRIANGLES, vertexCount, type, offset);
        }

        requestAnimationFrame(render);
    }

    return {
        start: () => {
            userScript.init(sceneState);
            requestAnimationFrame(render);
        },
        updateProgramInfo: (newProgramInfo) => {
            programInfo = newProgramInfo;
        },
        updateUserScript: (newUserScript) => {
            userScript = newUserScript;
            userScript.init(sceneState);
        },
        loadGeometry: (newDrawable) => {
            drawable = newDrawable;
        }
    };
}