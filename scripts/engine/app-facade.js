/**
 * @file Headless engine facade for React integration.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */
import { translateMatrix, rotateMatrix } from './matrix.js';
import { initShaderProgram } from './webgl-helpers.js';
import { createDefaultCube } from './geometry.js';
import { Camera } from './camera.js';
import { createScene } from './scene.js';

function buildProgramInfo(gl, program) {
    return {
        program,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(program, "aVertexPosition"),
            vertexNormal: gl.getAttribLocation(program, "aVertexNormal"),
            textureCoord: gl.getAttribLocation(program, "aTextureCoord"),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(program, "uProjectionMatrix"),
            modelViewMatrix: gl.getUniformLocation(program, "uModelViewMatrix"),
            uSampler: gl.getUniformLocation(program, "uSampler"),
            uBaseColor: gl.getUniformLocation(program, "uBaseColor"),
            uHasTexture: gl.getUniformLocation(program, "uHasTexture"),
        },
    };
}

export async function initEngine({ canvas, shaderSources, scriptSource, onError }) {
    const errorHandler = onError || ((err) => console.error(err));

    if (!canvas) {
        errorHandler(new Error('No canvas element provided.'));
        return null;
    }

    const gl = canvas.getContext('webgl');
    if (!gl) {
        errorHandler(new Error('Unable to initialize WebGL. Your browser may not support it.'));
        return null;
    }

    const camera = new Camera(canvas, [0, 0, 5]);
    const scene = createScene(gl, canvas, camera);

    const cubeGeometry = createDefaultCube(gl);
    scene.loadGeometry(cubeGeometry);

    function setShaders(vertexSource, fragmentSource) {
        const program = initShaderProgram(gl, vertexSource, fragmentSource);
        if (!program) {
            errorHandler(new Error('Shader compilation failed.'));
            return false;
        }
        scene.updateProgramInfo(buildProgramInfo(gl, program));
        return true;
    }

    function setScriptSource(source) {
        if (!source) return false;
        try {
            const scriptModule = new Function('translateMatrix', 'rotateMatrix', 'camera', `${source}\n return { init, update };`)(
                translateMatrix,
                rotateMatrix,
                camera
            );

            if (scriptModule && typeof scriptModule.init === 'function' && typeof scriptModule.update === 'function') {
                scene.updateUserScript(scriptModule);
                return true;
            }
            throw new Error("Script must export 'init' and 'update' functions.");
        } catch (e) {
            errorHandler(e);
            return false;
        }
    }

    if (!shaderSources?.vertex || !shaderSources?.fragment) {
        errorHandler(new Error('Missing shader sources.'));
        return null;
    }

    setShaders(shaderSources.vertex, shaderSources.fragment);
    setScriptSource(scriptSource);
    scene.start();

    return {
        gl,
        scene,
        camera,
        setShaders,
        setScriptSource
    };
}
