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
    let active = true; // Set to false permanently by destroy().
    let paused = false;
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
        if (!active || paused) return;
        if (reinitScript) {
            try { userScript.init(sceneState); } catch (e) { /* ignore */ }
        }
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(render);
        }
    }

    function render(now) {
        // Cleared before the active check: this callback has fired, so nothing is
        // scheduled any more either way. Returning early while still holding the
        // flag would strand it true, and a suspended loop (measureFrameCost) would
        // then never re-arm — rendering stops permanently after a benchmark.
        rafPending = false;
        if (!active || paused) return;
        try {
            _renderFrame(now);
        } catch (e) {
            console.error('WebGPU render error:', e);
        }
        if (active && !paused) {
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

        pause() {
            paused = true;
        },

        resume() {
            if (!active || !paused) return;
            paused = false;
            then = 0;
            forceUpdate();
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

        setSplatShaders(splatWgsl, sortWgsl, cullWgsl, radixWgsl) {
            if (!splatWgsl || !sortWgsl) return;
            splatRenderer.setShaders(splatWgsl, sortWgsl, cullWgsl, radixWgsl);
            if (drawable?.kind === 'splat') splatRenderer.prepare(drawable);
            forceUpdate();
        },

        setSplatReduction(mode) {
            splatRenderer.setReduction(mode);
            if (drawable?.kind === 'splat') splatRenderer.prepare(drawable);
            forceUpdate();
        },

        setSplatSort(mode) {
            // setSort() re-prepares internally (the render bind group holds the
            // active backend's index buffer), so no prepare() call here.
            splatRenderer.setSort(mode);
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

        /**
         * Measures end-to-end GPU cost per frame by rendering frames back to back
         * and awaiting `queue.onSubmittedWorkDone()` after each.
         *
         * This exists because neither existing signal is trustworthy at scale:
         * `fps` is the rAF callback rate (the GPU queues behind it, so it reads
         * ~60 while frames take a second), `frameMs` is CPU encode time only, and
         * timestamp readbacks stop landing entirely on very heavy scenes — a
         * 3.5M-splat cloud yields zero samples. Waiting on submitted work
         * measures the thing itself and degrades gracefully instead.
         *
         * The rAF loop is paused for the duration so measured frames don't
         * interleave with scheduled ones.
         *
         * @param {{frames?: number, warmup?: number}} [opts]
         * @returns {Promise<{frames:number, medianMs:number, meanMs:number, minMs:number, maxMs:number}|null>}
         */
        async measureFrameCost({ frames = 20, warmup = 3 } = {}) {
            if (!drawable || !rendererFor(drawable)) return null;
            const wasActive = active;
            active = false; // suspend the rAF loop
            try {
                for (let i = 0; i < warmup; i++) {
                    _renderFrame(performance.now());
                    await device.queue.onSubmittedWorkDone();
                }
                const samples = [];
                for (let i = 0; i < frames; i++) {
                    const t0 = performance.now();
                    _renderFrame(performance.now());
                    await device.queue.onSubmittedWorkDone();
                    samples.push(performance.now() - t0);
                }
                if (samples.length === 0) return null;
                const sorted = [...samples].sort((a, b) => a - b);
                return {
                    frames: sorted.length,
                    medianMs: sorted[Math.floor(sorted.length / 2)],
                    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
                    minMs: sorted[0],
                    maxMs: sorted[sorted.length - 1],
                };
            } finally {
                active = wasActive;
                if (active && !paused && !rafPending) {
                    rafPending = true;
                    requestAnimationFrame(render);
                }
            }
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
                sortMode: info?.sort ?? 'bitonic',
                // Splats actually drawn after reduction (== total when not culling).
                visibleSplats: (info && info.visible >= 0) ? info.visible : total,
                passMs: gpuTimer.getDurations(), // { sort?, reduce? } in ms, GPU timestamp based
            };
        },

        destroy() {
            active = false;
            paused = true;
            if (drawable) rendererFor(drawable)?.releaseDrawable(drawable);
            meshRenderer.destroy();
            splatRenderer.destroy();
            splatTileRenderer.destroy();
            gpuTimer.destroy();
            drawable = null;
        },
    };
}
