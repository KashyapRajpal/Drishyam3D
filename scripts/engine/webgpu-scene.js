/**
 * @file WebGPU scene core — owns shared per-frame state and the render loop,
 *       and dispatches to a Renderer based on the active drawable's `kind`.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Shared entities (device/context/camera, view + projection matrices, the
 * user-script tick, resize, and the RAF loop) live here once. Everything that
 * differs per drawable kind lives in a Renderer (see ./renderers/). Adding a
 * new drawable kind is a new Renderer subclass plus a registry entry — the
 * core does not change.
 */
import { createIdentityMatrix, createPerspectiveMatrix } from './matrix.js';
import { MeshRenderer } from './renderers/mesh-renderer.js';
import { SplatRenderer } from './renderers/splat-renderer.js';

export function createWebGPUScene(device, context, format, canvas, camera) {
    let drawable = null;
    let active = true; // Set to false by destroy() to stop this scene's render loop
    let then = 0;

    let userScript = { init: () => {}, update: () => {} };
    const sceneState = { modelRotation: 0.0, modelViewMatrix: null };

    // Renderer registry — one per drawable kind.
    const meshRenderer = new MeshRenderer(device, format);
    const splatRenderer = new SplatRenderer(device, format);
    const renderers = new Map([
        [meshRenderer.kind, meshRenderer],
        [splatRenderer.kind, splatRenderer],
    ]);

    function rendererFor(target) {
        if (!target) return null;
        return renderers.get(target.kind ?? 'mesh') ?? null;
    }

    function getDrawable() { return drawable; }

    function setDrawable(next) {
        if (next === drawable) return;
        const previous = drawable;
        drawable = next;
        if (previous) rendererFor(previous)?.releaseDrawable(previous);
        rendererFor(drawable)?.prepare(drawable);
        requestAnimationFrame(render);
        forceUpdate({ reinitScript: true });
    }

    function resizeCanvas() {
        const displayWidth = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
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

        const current = getDrawable();
        const renderer = rendererFor(current);
        if (!renderer || !current) {
            requestAnimationFrame(render);
            return;
        }

        resizeCanvas();
        const width = canvas.width;
        const height = canvas.height;
        if (width === 0 || height === 0) {
            requestAnimationFrame(render);
            return;
        }

        // --- Shared per-frame state (computed once for every renderer) ---
        const fieldOfView = 45 * Math.PI / 180;
        const aspect = width / height;
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, 0.1, 100.0);

        camera.updateViewMatrix();
        const viewMatrix = camera.getViewMatrix();

        // The user script mutates sceneState.modelViewMatrix as the model matrix.
        sceneState.modelViewMatrix = createIdentityMatrix();
        try { userScript.update(sceneState, deltaTime); } catch (e) { /* ignore */ }

        const encoder = device.createCommandEncoder();
        const targetView = context.getCurrentTexture().createView();
        const frame = {
            device,
            encoder,
            targetView,
            camera,
            viewMatrix,
            projectionMatrix,
            width,
            height,
            deltaTime,
            sceneState,
        };

        renderer.record(frame, current);

        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(render);
    }

    return {
        start() {
            for (const r of renderers.values()) r.init();
            forceUpdate({ reinitScript: true });
        },

        updatePipeline(newPipeline) {
            meshRenderer.setPipeline(newPipeline);
            rendererFor(drawable)?.prepare(drawable);
            forceUpdate();
        },

        updateUserScript(newScript) {
            userScript = newScript;
            forceUpdate({ reinitScript: false });
        },

        setSplatShaders(splatWgsl, sortWgsl) {
            if (!splatWgsl || !sortWgsl) return;
            splatRenderer.setShaders(splatWgsl, sortWgsl);
            if (drawable?.kind === 'splat') splatRenderer.prepare(drawable);
            forceUpdate();
        },

        setSplatDebugMode(mode) {
            splatRenderer.setDebugMode(mode);
            forceUpdate();
        },

        loadGeometry(newDrawable) {
            setDrawable(newDrawable);
        },

        getDrawable,

        destroy() {
            active = false;
            if (drawable) rendererFor(drawable)?.releaseDrawable(drawable);
            for (const r of renderers.values()) r.destroy();
            drawable = null;
        },
    };
}
