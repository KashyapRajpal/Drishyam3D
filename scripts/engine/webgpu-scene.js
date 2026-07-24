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
import { SplatTileRenderer } from './renderers/splat-tile-renderer.js';

export function createWebGPUScene(device, context, format, canvas, camera) {
    let drawable = null;
    let active = true; // Set to false by destroy() to stop this scene's render loop
    let then = 0;
    let fpsAccum = 0, fpsCount = 0, displayFps = 0, displayMs = 0;
    let rafPending = false; // Guard against rAF loop accumulation

    // Real frame-time measurement via GPU timestamps or CPU fallback.
    let lastFrameTime = 0;
    const supportsTimestamps = device.features?.has?.('timestamp-query') ?? false;
    let querySet = null, resolveBuffer = null;
    if (supportsTimestamps) {
        querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
        resolveBuffer = device.createBuffer({
            size: 16, // 2 × u64
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
    }

    let userScript = { init: () => {}, update: () => {} };
    const sceneState = { modelRotation: 0.0, modelViewMatrix: null };

    // Renderer registry — one per drawable kind.
    const meshRenderer = new MeshRenderer(device, format);
    const splatRenderer = new SplatRenderer(device, format);
    const splatTileRenderer = new SplatTileRenderer(device, format);
    let activeSplatRenderer = splatRenderer; // Toggle between instanced and tile modes
    const renderers = new Map([
        ['mesh', meshRenderer],
        ['splat', null], // Resolved via activeSplatRenderer
    ]);

    function rendererFor(target) {
        if (!target) return null;
        const kind = target.kind ?? 'mesh';
        if (kind === 'splat') return activeSplatRenderer;
        return renderers.get(kind) ?? null;
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
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(render);
        }
    }

    function render(now) {
        if (!active) return;
        rafPending = false;
        try {
            _renderFrame(now);
        } catch (e) {
            console.error('WebGPU render error:', e);
        }
        if (active) {
            rafPending = true;
            requestAnimationFrame(render);
        }
    }

    function _renderFrame(now) {
        const frameStartTime = performance.now();
        now *= 0.001;
        const deltaTime = now - then;
        then = now;

        // Rolling FPS (update display every ~500ms).
        if (deltaTime > 0) {
            fpsAccum += 1 / deltaTime;
            fpsCount++;
            if (fpsCount >= 30) {
                displayFps = Math.round(fpsAccum / fpsCount);
                fpsAccum = 0;
                fpsCount = 0;
            }
        }

        const current = getDrawable();
        const renderer = rendererFor(current);
        if (!renderer || !current) {
            return;
        }

        resizeCanvas();
        const width = canvas.width;
        const height = canvas.height;
        if (width === 0 || height === 0) {
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

        // Measure actual frame time.
        const frameEndTime = performance.now();
        lastFrameTime = frameEndTime - frameStartTime;
        displayMs = Math.round(lastFrameTime * 100) / 100;
    }

    return {
        start() {
            meshRenderer.init();
            splatRenderer.init();
            splatTileRenderer.init();
            forceUpdate({ reinitScript: true });
        },

        setSplatRenderMode(mode) {
            const nextRenderer = mode === 'tile' ? splatTileRenderer : splatRenderer;
            if (activeSplatRenderer === nextRenderer) return;
            activeSplatRenderer = nextRenderer;
            if (drawable?.kind === 'splat') {
                activeSplatRenderer.prepare(drawable);
            }
            forceUpdate();
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

        setBlitShader(blitWgsl) {
            if (!blitWgsl) return;
            splatTileRenderer.setShaders(blitWgsl);
            if (drawable?.kind === 'splat' && activeSplatRenderer === splatTileRenderer) {
                splatTileRenderer.prepare(drawable);
            }
            forceUpdate();
        },

        setSplatDebugMode(mode) {
            splatRenderer.setDebugMode(mode);
            forceUpdate();
        },

        setSplatShDegree(degree) {
            splatRenderer.setMaxShDegree(degree);
            forceUpdate();
        },

        loadGeometry(newDrawable) {
            setDrawable(newDrawable);
        },

        getDrawable,

        getStats() {
            return {
                backend: 'webgpu',
                fps: displayFps,
                frameMs: displayMs,
                drawableKind: drawable?.kind ?? 'none',
                triangleCount: drawable?.kind === 'mesh' ? drawable.vertexCount / 3 : 0,
                splatCount: drawable?.kind === 'splat' ? drawable.count : 0,
            };
        },

        destroy() {
            active = false;
            if (drawable) rendererFor(drawable)?.releaseDrawable(drawable);
            meshRenderer.destroy();
            splatRenderer.destroy();
            splatTileRenderer.destroy();
            drawable = null;
        },
    };
}
