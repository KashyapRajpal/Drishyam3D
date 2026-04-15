/**
 * @file Manages the WebGPU scene, rendering loop, and drawable objects.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix, createPerspectiveMatrix, createLookAtMatrix, multiplyMatrices } from './matrix.js';
import {
    MATRIX_UNIFORM_SIZE,
    MATERIAL_UNIFORM_SIZE,
    createRenderPipeline,
    createUniformBuffer,
    createDefaultTexture,
    createSampler,
    createDepthTexture,
    createBindGroup,
} from './webgpu-helpers.js';

let _drawable = null;

export function createWebGPUScene(device, context, format, canvas, camera) {
    _drawable = null; // Clear stale buffers from any previous context
    let pipeline = null;
    let matrixBuffer = null;
    let materialBuffer = null;
    let sampler = null;
    let defaultTexture = null;
    let depthTexture = null;
    let bindGroup = null;
    let depthWidth = 0;
    let depthHeight = 0;

    let userScript = { init: () => {}, update: () => {} };
    const sceneState = { modelRotation: 0.0, modelViewMatrix: null };
    let then = 0;
    let active = true; // Set to false by destroy() to stop this scene's render loop

    // Scratch ArrayBuffers reused every frame to avoid per-frame allocations
    const matrixData = new Float32Array(32);     // 2x mat4 = 32 floats
    const materialData = new Float32Array(8);    // vec4 + u32 + pad = 8 floats

    function getDrawable() { return _drawable; }

    function setDrawable(next) {
        if (next === _drawable) return;
        _drawable = next;
        requestAnimationFrame(render);
        forceUpdate({ reinitScript: true });
    }

    function rebuildBindGroup() {
        if (!pipeline || !matrixBuffer || !materialBuffer || !sampler || !defaultTexture) return;
        const drawable = getDrawable();
        const texture = drawable?.texture ?? defaultTexture;
        bindGroup = createBindGroup(device, pipeline, {
            matrixBuffer,
            materialBuffer,
            sampler,
            texture,
        });
    }

    function ensureDepthTexture(width, height) {
        if (depthTexture && depthWidth === width && depthHeight === height) return;
        if (depthTexture) depthTexture.destroy();
        depthTexture = createDepthTexture(device, width, height);
        depthWidth = width;
        depthHeight = height;
    }

    function resizeCanvas() {
        const displayWidth  = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width  = displayWidth;
            canvas.height = displayHeight;
            context.configure({
                device,
                format,
                alphaMode: 'premultiplied',
            });
        }
    }

    function forceUpdate({ reinitScript = false } = {}) {
        if (!active) return;
        if (reinitScript) {
            try { userScript.init(sceneState); } catch (e) { /* ignore */ }
        }
        requestAnimationFrame(render);
    }

    function render(now) {
        if (!active) return;
        try {
            _renderFrame(now);
        } catch (e) {
            console.error('WebGPU render error:', e);
            requestAnimationFrame(render);
        }
    }

    function _renderFrame(now) {
        now *= 0.001;
        const deltaTime = now - then;
        then = now;

        const drawable = getDrawable();

        if (!pipeline || !drawable) {
            requestAnimationFrame(render);
            return;
        }

        resizeCanvas();
        const width  = canvas.width;
        const height = canvas.height;
        if (width === 0 || height === 0) {
            requestAnimationFrame(render);
            return;
        }

        ensureDepthTexture(width, height);

        // Build matrices
        const fieldOfView = 45 * Math.PI / 180;
        const aspect = width / height;
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, 0.1, 100.0);

        camera.updateViewMatrix();
        const viewMatrix = camera.getViewMatrix();
        const modelMatrix = createIdentityMatrix();
        sceneState.modelViewMatrix = modelMatrix;

        try { userScript.update(sceneState, deltaTime); } catch (e) { /* ignore */ }

        const modelViewMatrix = multiplyMatrices(viewMatrix, modelMatrix);

        // Upload matrices
        matrixData.set(projectionMatrix, 0);
        matrixData.set(modelViewMatrix, 16);
        device.queue.writeBuffer(matrixBuffer, 0, matrixData);

        // Upload material — hasTexture written as u32 at byte offset 16
        const hasTexture = drawable.texture ? 1 : 0;
        const baseColor = hasTexture ? [1, 1, 1, 1] : [0.5, 0.5, 1.0, 1.0];
        materialData[0] = baseColor[0];
        materialData[1] = baseColor[1];
        materialData[2] = baseColor[2];
        materialData[3] = baseColor[3];
        new Uint32Array(materialData.buffer)[4] = hasTexture;
        device.queue.writeBuffer(materialBuffer, 0, materialData);

        // Rebuild bind group only when the drawable's texture changes
        const expectedTexture = drawable.texture ?? defaultTexture;
        if (!bindGroup || bindGroup._texture !== expectedTexture) {
            bindGroup = createBindGroup(device, pipeline, {
                matrixBuffer,
                materialBuffer,
                sampler,
                texture: expectedTexture,
            });
            bindGroup._texture = expectedTexture;
        }

        // Record and submit
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, drawable.buffers.position);
        pass.setVertexBuffer(1, drawable.buffers.normal);
        pass.setVertexBuffer(2, drawable.buffers.texCoord);
        pass.setIndexBuffer(drawable.buffers.indices, 'uint16');
        pass.drawIndexed(drawable.vertexCount);
        pass.end();

        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(render);
    }

    return {
        start() {
            matrixBuffer    = createUniformBuffer(device, MATRIX_UNIFORM_SIZE);
            materialBuffer  = createUniformBuffer(device, MATERIAL_UNIFORM_SIZE);
            sampler         = createSampler(device);
            defaultTexture  = createDefaultTexture(device);
            forceUpdate({ reinitScript: true });
        },

        updatePipeline(newPipeline) {
            pipeline = newPipeline;
            rebuildBindGroup();
            forceUpdate();
        },

        updateUserScript(newScript) {
            userScript = newScript;
            forceUpdate({ reinitScript: false });
        },

        loadGeometry(newDrawable) {
            setDrawable(newDrawable);
        },

        getDrawable,

        destroy() {
            active = false;
            _drawable = null;
        },
    };
}
