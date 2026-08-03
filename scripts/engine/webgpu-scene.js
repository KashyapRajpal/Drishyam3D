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
import { GpuTimer } from './gpu-timer.js';

export function createWebGPUScene(device, context, format, canvas, camera) {
    let drawable = null;
    let active = true; // Set to false by destroy() to stop this scene's render loop
    let then = 0;
    let fpsAccum = 0, fpsCount = 0, displayFps = 0, displayMs = 0;
    let rafPending = false; // Guard against rAF loop accumulation

    // Real frame-time measurement (CPU) + per-pass GPU timing (timestamp queries).
    let lastFrameTime = 0;
    const gpuTimer = new GpuTimer(device);

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
        gpuTimer.beginFrame();
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
        // Fit near/far to the scene's scale so large scanned meshes (coords in the
        // hundreds) aren't clipped by a fixed 100-unit far plane; small scenes
        // (cube/sphere/splat, ~unit-scale) keep the original 0.1 / 100 range.
        const boundsRadius = drawable?.bounds?.radius ?? 0;
        const zFar = Math.max(100, (camera.zoom + boundsRadius) * 2 + 10);
        const zNear = Math.max(0.1, zFar / 1000);
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar);

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
            gpuTimer,
        };

        renderer.record(frame, current);

        gpuTimer.resolve(encoder);
        device.queue.submit([encoder.finish()]);
        gpuTimer.readback(); // async; not awaited (single-flight)

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

        setSplatShaders(splatWgsl, sortWgsl, cullWgsl) {
            if (!splatWgsl || !sortWgsl) return;
            splatRenderer.setShaders(splatWgsl, sortWgsl, cullWgsl);
            if (drawable?.kind === 'splat') splatRenderer.prepare(drawable);
            forceUpdate();
        },

        setSplatReduction(mode) {
            splatRenderer.setReduction(mode);
            if (drawable?.kind === 'splat') splatRenderer.prepare(drawable);
            forceUpdate();
        },

        setTileShaders(blitWgsl, tileRenderWgsl) {
            if (!blitWgsl || !tileRenderWgsl) return;
            splatTileRenderer.setShaders(blitWgsl, tileRenderWgsl);
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
            const isSplat = drawable?.kind === 'splat';
            const info = isSplat ? activeSplatRenderer.getReductionInfo?.() : null;
            const total = isSplat ? drawable.count : 0;
            return {
                backend: 'webgpu',
                fps: displayFps,
                frameMs: displayMs,
                drawableKind: drawable?.kind ?? 'none',
                triangleCount: drawable?.kind === 'mesh' ? drawable.vertexCount / 3 : 0,
                splatCount: total,
                reductionMode: info?.mode ?? 'none',
                // Splats actually drawn after reduction (== total when not culling).
                visibleSplats: (info && info.visible >= 0) ? info.visible : total,
                passMs: gpuTimer.getDurations(), // { sort?, reduce? } in ms, GPU timestamp based
            };
        },

        destroy() {
            active = false;
            if (drawable) rendererFor(drawable)?.releaseDrawable(drawable);
            meshRenderer.destroy();
            splatRenderer.destroy();
            splatTileRenderer.destroy();
            gpuTimer.destroy();
            drawable = null;
        },
    };
}
