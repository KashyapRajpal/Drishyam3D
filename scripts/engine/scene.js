/**
 * @file Manages the WebGL scene, rendering loop, and drawable objects.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix, createPerspectiveMatrix, createLookAtMatrix, multiplyMatrices } from './matrix.js';

function resizeCanvas(canvas) {
    const displayWidth  = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width  !== displayWidth || canvas.height !== displayHeight) {
      canvas.width  = displayWidth;
      canvas.height = displayHeight;
    }
}

export function createScene(gl, canvas, camera) {
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
    let lastDrawable = null;

    let programInfo = null;
    let userScript = {
        init: () => {},
        update: () => {}
    };

    // Optional debug unlit program used to quickly verify raw geometry visibility.
    let _unlitProgramInfo = null;

    function _createUnlitProgram() {
        const vsSource = `attribute vec3 aVertexPosition;
        uniform mat4 projectionMatrix;
        uniform mat4 modelViewMatrix;
        void main(void) {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(aVertexPosition, 1.0);
        }`;

        const fsSource = `precision mediump float;
        void main(void) {
            gl_FragColor = vec4(1.0, 0.2, 0.8, 1.0);
        }`;

        function compileShader(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const info = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error('Shader compile error: ' + info);
            }
            return shader;
        }

        const vert = compileShader(gl.VERTEX_SHADER, vsSource);
        const frag = compileShader(gl.FRAGMENT_SHADER, fsSource);
        const prog = gl.createProgram();
        gl.attachShader(prog, vert);
        gl.attachShader(prog, frag);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(prog);
            gl.deleteProgram(prog);
            throw new Error('Program link error: ' + info);
        }

        _unlitProgramInfo = {
            program: prog,
            attribLocations: {
                vertexPosition: gl.getAttribLocation(prog, 'aVertexPosition'),
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(prog, 'projectionMatrix'),
                modelViewMatrix: gl.getUniformLocation(prog, 'modelViewMatrix'),
            }
        };
    }

    function debugDrawUnlit(d) {
        // Make the unlit debug draw robust to timing: the drawable may be set
        // but buffers might not be available yet. If buffers are missing, retry
        // once on the next frame.
        if (!d) {
            console.warn('Unlit debug: no drawable provided');
            return;
        }

        if (!d.buffers || !d.buffers.position || !d.buffers.indices) {
            // Schedule a one-time retry on the next animation frame using the
            // currently-stored `drawable` reference, but avoid spinning.
            requestAnimationFrame(() => {
                if (d === drawable) {
                    try {
                        debugDrawUnlit(d);
                    } catch (e) {
                        console.warn('Unlit debug draw retry failed:', e);
                    }
                }
            });
            return;
        }

        try {
            if (!_unlitProgramInfo) _createUnlitProgram();
        } catch (e) {
            console.warn('Failed to compile unlit debug program:', e);
            return;
        }

        const info = _unlitProgramInfo;
        gl.useProgram(info.program);

        // Compute projection/modelView using the current camera so the debug
        // draw appears in the same view as the scene.
        const fieldOfView = 45 * Math.PI / 180;
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar);
        camera.updateViewMatrix();
        const viewMatrix = camera.getViewMatrix();
        const modelMatrix = createIdentityMatrix();
        const modelViewMatrix = multiplyMatrices(viewMatrix, modelMatrix);

        // Bind position attribute if available
        const posLoc = info.attribLocations.vertexPosition;
        if (posLoc !== -1 && posLoc !== null) {
            gl.bindBuffer(gl.ARRAY_BUFFER, d.buffers.position);
            gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(posLoc);
        }

        // Bind index buffer
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.buffers.indices);

        // Upload matrices
        gl.uniformMatrix4fv(info.uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(info.uniformLocations.modelViewMatrix, false, modelViewMatrix);

        try {
            gl.drawElements(gl.TRIANGLES, d.vertexCount, d.indexType, 0);
            const err = gl.getError();
            if (err !== gl.NO_ERROR) console.warn('GL error after unlit debug draw:', err);
            else console.log('Unlit debug draw completed (check the canvas).');
        } catch (e) {
            console.warn('Unlit debug draw failed:', e);
        }
    }

    const sceneState = {
        modelRotation: 0.0,
        modelViewMatrix: null,
    };

    let then = 0;

    function forceUpdate({ reinitScript = false } = {}) {
        if (reinitScript) {
            try {
                userScript.init(sceneState);
            } catch (e) {
                // ignore init errors
            }
        }
        requestAnimationFrame(render);
    }

    function render(now) {
        now *= 0.001; // Convert to seconds
        const deltaTime = now - then;
        then = now;

        if (drawable !== lastDrawable) {
            if (drawable) {
                console.log('Scene render using drawable:', drawable);
                if (programInfo) {
                    console.log('Current program attribLocations:', programInfo.attribLocations);
                } else {
                    console.log('No programInfo available yet.');
                }
                if (drawable._debug) {
                    console.log('Drawable debug counts:', drawable._debug);
                }
            }
            lastDrawable = drawable;
        }

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

        // Update the camera matrix and get the view matrix
        camera.updateViewMatrix();
        const viewMatrix = camera.getViewMatrix();

        // The model matrix is separate and will be modified by the user script
        const modelMatrix = createIdentityMatrix();
        sceneState.modelViewMatrix = modelMatrix; // Pass the model matrix to the user script

        try {
            userScript.update(sceneState, deltaTime);
        } catch (e) {
            console.warn('Scene script update failed:', e);
        }

        // Multiply the view matrix and model matrix to get the final model-view matrix
        const modelViewMatrix = multiplyMatrices(viewMatrix, modelMatrix);

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
            const errAfter = gl.getError();
            if (errAfter !== gl.NO_ERROR) console.warn('GL error after drawElements:', errAfter);
        }

        requestAnimationFrame(render);
    }

    return {
        start: () => {
            forceUpdate({ reinitScript: true });
        },
        updateProgramInfo: (newProgramInfo) => {
            programInfo = newProgramInfo;
            forceUpdate();
        },
        updateUserScript: (newUserScript) => {
            userScript = newUserScript;
            forceUpdate({ reinitScript: true });
        },
        loadGeometry: (newDrawable) => {
            drawable = newDrawable;
            // Perform a one-time unlit debug draw to help surface raw geometry issues.
            // Schedule on the next animation frame so that any async buffer setup
            // (if present) has a chance to complete and we won't access nulls.
            if (newDrawable) {
                requestAnimationFrame(() => {
                    try {
                        debugDrawUnlit(drawable);
                    } catch (e) {
                        console.warn('Debug unlit draw failed:', e);
                    }
                });
            }
            forceUpdate({ reinitScript: true });
        }
    };
}