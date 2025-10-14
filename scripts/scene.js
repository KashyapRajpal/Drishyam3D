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
    let drawable = null; // Will hold { buffers, vertexCount }

    let programInfo = null;
    let userScript = {
        init: () => {},
        update: () => {}
    };

    const sceneState = {
        cubeRotation: 0.0,
        modelViewMatrix: null,
    };

    let then = 0;

    function render(now) {
        now *= 0.001; // Convert to seconds
        const deltaTime = now - then;
        then = now;

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

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, drawable.buffers.indices);
        gl.useProgram(programInfo.program);

        gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);

        {
            const vertexCount = drawable.vertexCount;
            const type = gl.UNSIGNED_SHORT;
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