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
import { RayTraceRenderer } from './renderers/raytrace-renderer.js';
import { HybridShadowRenderer } from './renderers/hybrid-shadow-renderer.js';
import { GpuTimer } from './gpu-timer.js';

export function createWebGPUScene(device, context, format, canvas, camera) {
    let rasterDrawable = null;
    let rayDrawable = null;
    let renderMode = 'raster';
    let active = true; // Set to false permanently by destroy().
    let destroyed = false;
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
    const rayTraceRenderer = new RayTraceRenderer(device, format);
    const hybridShadowRenderer = new HybridShadowRenderer(device, format);
    let rayShaderReady = false;
    let hybridShadersReady = false;
    let hybridShadowReady = false;
    let activeSplatRenderer = splatRenderer; // Toggle between instanced and tile modes
    const renderers = new Map([
        ['mesh', meshRenderer],
        ['splat', null], // Resolved via activeSplatRenderer
    ]);

    function rendererFor(target, requestedMode = renderMode) {
        if (!target) return null;
        if (requestedMode === 'raytrace-gpu') return target.kind === 'raytrace' ? rayTraceRenderer : null;
        if (requestedMode === 'hybrid-shadows') return target.kind === 'mesh' ? hybridShadowRenderer : null;
        const kind = target.kind ?? 'mesh';
        if (kind === 'splat') return activeSplatRenderer;
        return renderers.get(kind) ?? null;
    }

    function getDrawable() {
        return renderMode === 'raytrace-gpu' ? rayDrawable : rasterDrawable;
    }

    function setRasterDrawable(next) {
        if (next === rasterDrawable) return;
        const previous = rasterDrawable;
        rasterDrawable = next;
        if (previous) {
            rendererFor(previous, 'raster')?.releaseDrawable(previous);
            if ((previous.kind ?? 'mesh') === 'mesh') hybridShadowRenderer.releaseDrawable(previous);
        }
        if (renderMode !== 'raytrace-gpu') rendererFor(rasterDrawable, renderMode)?.prepare(rasterDrawable);
        forceUpdate({ reinitScript: true });
    }

    function setRayDrawable(next) {
        if (next === rayDrawable) return;
        const previous = rayDrawable;
        rayDrawable = next;
        if (previous) rayTraceRenderer.releaseDrawable(previous);
        if (renderMode === 'raytrace-gpu') rayTraceRenderer.prepare(rayDrawable);
        forceUpdate();
    }

    function unsupportedMode(message) {
        const error = new Error(message);
        error.code = 'UNSUPPORTED_RENDER_MODE';
        return error;
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
        const boundsRadius = current?.bounds?.radius ?? 0;
        const zFar = Math.max(100, (camera.zoom + boundsRadius) * 2 + 10);
        const zNear = Math.max(0.1, zFar / 1000);
        const projectionMatrix = createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar);

        camera.updateViewMatrix();
        const viewMatrix = camera.getViewMatrix();

        // The user script mutates sceneState.modelViewMatrix as the model matrix.
        sceneState.modelViewMatrix = createIdentityMatrix();
        if (renderMode === 'raster' || renderMode === 'hybrid-shadows') {
            try { userScript.update(sceneState, deltaTime); } catch (e) { /* ignore */ }
        }

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
            hybridShadowRenderer.init();
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
            if (rasterDrawable?.kind === 'splat') {
                activeSplatRenderer.prepare(rasterDrawable);
            }
            forceUpdate();
        },

        updatePipeline(newPipeline) {
            meshRenderer.setPipeline(newPipeline);
            if (renderMode === 'raster') rendererFor(rasterDrawable, 'raster')?.prepare(rasterDrawable);
            forceUpdate();
        },

        updateUserScript(newScript) {
            userScript = newScript;
            forceUpdate({ reinitScript: false });
        },

        setSplatShaders(splatWgsl, sortWgsl, cullWgsl, radixWgsl) {
            if (!splatWgsl || !sortWgsl) return;
            splatRenderer.setShaders(splatWgsl, sortWgsl, cullWgsl, radixWgsl);
            if (rasterDrawable?.kind === 'splat') splatRenderer.prepare(rasterDrawable);
            forceUpdate();
        },

        setSplatReduction(mode) {
            splatRenderer.setReduction(mode);
            if (rasterDrawable?.kind === 'splat') splatRenderer.prepare(rasterDrawable);
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
            if (rasterDrawable?.kind === 'splat' && activeSplatRenderer === splatTileRenderer) {
                splatTileRenderer.prepare(rasterDrawable);
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

        setRayTracingShader(wgslSource) {
            if (!wgslSource) return false;
            rayTraceRenderer.setShader(wgslSource);
            rayShaderReady = true;
            if (renderMode === 'raytrace-gpu' && rayDrawable) rayTraceRenderer.prepare(rayDrawable);
            forceUpdate();
            return true;
        },

        setHybridShaders(gbufferSource, compositeSource) {
            if (!gbufferSource || !compositeSource) return false;
            hybridShadowRenderer.setShaders(gbufferSource, compositeSource);
            hybridShadersReady = true;
            if (renderMode === 'hybrid-shadows' && rasterDrawable) hybridShadowRenderer.prepare(rasterDrawable);
            forceUpdate();
            return true;
        },

        setHybridShadowShader(shadowSource) {
            if (!shadowSource) return false;
            hybridShadowRenderer.setShadowShader(shadowSource);
            hybridShadowReady = true;
            if (renderMode === 'hybrid-shadows' && rasterDrawable) hybridShadowRenderer.prepare(rasterDrawable);
            forceUpdate();
            return true;
        },

        setHybridLight(light) {
            hybridShadowRenderer.setLight(light);
            forceUpdate();
        },

        setRenderMode(nextMode) {
            if (nextMode !== 'raster' && nextMode !== 'raytrace-gpu' && nextMode !== 'hybrid-shadows') {
                throw unsupportedMode(`Unsupported WebGPU render mode: ${nextMode}`);
            }
            if (nextMode === renderMode) return;
            if (nextMode === 'raytrace-gpu') {
                if (!rayShaderReady) throw unsupportedMode('GPU ray tracing shader is unavailable.');
                if (!rayDrawable) throw unsupportedMode('No ray-traceable scene is loaded.');
                rayTraceRenderer.prepare(rayDrawable);
            } else if (nextMode === 'hybrid-shadows') {
                if (!hybridShadersReady) throw unsupportedMode('Hybrid shadow shaders are unavailable.');
                if (!hybridShadowReady) throw unsupportedMode('Hybrid any-hit shadow shader is unavailable.');
                if (!rasterDrawable || (rasterDrawable.kind ?? 'mesh') !== 'mesh') {
                    throw unsupportedMode('Hybrid shadows require a triangle mesh drawable.');
                }
                if (!rasterDrawable.rayTracing?.preparedRayScene) {
                    throw unsupportedMode('Hybrid shadows require a ray-traceable mesh sidecar.');
                }
                hybridShadowRenderer.prepare(rasterDrawable);
            } else if (rasterDrawable) {
                rendererFor(rasterDrawable, 'raster')?.prepare(rasterDrawable);
            }
            renderMode = nextMode;
            then = 0;
            forceUpdate();
        },

        getRenderMode: () => renderMode,

        setRayTracingSettings(partial) {
            rayTraceRenderer.setSettings(partial);
            forceUpdate();
        },

        resetRayAccumulation() {
            rayTraceRenderer.resetAccumulation();
            forceUpdate();
        },

        updateRayTlasAndInstances(target, packed, ranges) {
            if (target !== rayDrawable) throw new Error('TLAS update target is not the retained ray drawable.');
            rayTraceRenderer.updateTlasAndInstances(target, packed, ranges);
            forceUpdate();
        },

        readRayAccumulation: () => rayTraceRenderer.readAccumulation(),
        readRayDiagnostics: () => rayTraceRenderer.readDiagnostics(),

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
            if (!getDrawable() || !rendererFor(getDrawable())) return null;
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
            setRasterDrawable(newDrawable);
        },

        loadRayGeometry(newDrawable) {
            setRayDrawable(newDrawable);
        },

        getDrawable,
        getRasterDrawable: () => rasterDrawable,
        getRayDrawable: () => rayDrawable,

        getStats() {
            const drawable = getDrawable();
            if (renderMode === 'raytrace-gpu') {
                return {
                    ...rayTraceRenderer.getStats(),
                    fps: displayFps,
                    frameMs: displayMs,
                    passMs: gpuTimer.getDurations(),
                };
            }
            if (renderMode === 'hybrid-shadows') {
                return {
                    ...hybridShadowRenderer.getStats(),
                    fps: displayFps,
                    frameMs: displayMs,
                    passMs: gpuTimer.getDurations(),
                };
            }
            const isSplat = drawable?.kind === 'splat';
            const info = isSplat ? activeSplatRenderer.getReductionInfo?.() : null;
            const total = isSplat ? drawable.count : 0;
            return {
                backend: 'webgpu',
                renderMode,
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
            if (destroyed) return;
            destroyed = true;
            active = false;
            paused = true;
            if (rasterDrawable) {
                rendererFor(rasterDrawable, 'raster')?.releaseDrawable(rasterDrawable);
                if ((rasterDrawable.kind ?? 'mesh') === 'mesh') hybridShadowRenderer.releaseDrawable(rasterDrawable);
            }
            if (rayDrawable) rayTraceRenderer.releaseDrawable(rayDrawable);
            meshRenderer.destroy();
            splatRenderer.destroy();
            splatTileRenderer.destroy();
            rayTraceRenderer.destroy();
            hybridShadowRenderer.destroy();
            gpuTimer.destroy();
            rasterDrawable = null;
            rayDrawable = null;
        },
    };
}
