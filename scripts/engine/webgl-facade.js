/**
 * @file WebGL engine facade — the original rendering backend.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */
import { initShaderProgram } from './webgl-helpers.js';
import { compileUserScript } from './script-runtime.js';
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

export async function initWebGLEngine({ canvas, shaderSources, scriptSource, onError }) {
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
            scene.updateUserScript(compileUserScript(source, { camera }));
            return true;
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
        setScriptSource,
        getStats: () => scene.getStats(),
        destroy: () => {
            scene.destroy();
            camera.destroy();
        },
    };
}
