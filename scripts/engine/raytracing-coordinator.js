const RAY_MODES = new Set(['raytrace-cpu', 'raytrace-gpu']);
const RENDER_MODES = new Set(['raster', 'raytrace-cpu', 'raytrace-gpu', 'hybrid-shadows']);

function unsupportedMode(message) {
    const error = new Error(message);
    error.code = 'UNSUPPORTED_RENDER_MODE';
    return error;
}

function normalizeSceneAsset(source) {
    if (!source) return null;
    const sidecar = source.rayTracing || source;
    const preparedRayScene = sidecar.preparedRayScene || sidecar.rayScene || sidecar.asset?.rayScene;
    if (!preparedRayScene) throw new Error('Scene asset requires a prepared RayScene.');
    const sourceRevisions = sidecar.revisions || sidecar.asset?.revisions || {};
    return {
        source,
        preparedRayScene,
        revisions: {
            geometryRevision: sidecar.geometryRevision ?? sourceRevisions.geometryRevision ?? 0,
            instanceRevision: sidecar.instanceRevision ?? sourceRevisions.instanceRevision ?? 0,
            materialRevision: sidecar.materialRevision ?? sourceRevisions.materialRevision ?? 0,
            lightRevision: sidecar.lightRevision ?? sourceRevisions.lightRevision ?? 0,
            cameraRevision: sidecar.cameraRevision ?? sourceRevisions.cameraRevision ?? 0,
            settingsRevision: sidecar.settingsRevision ?? sourceRevisions.settingsRevision ?? 0,
        },
    };
}

function copyCameraState(source, target) {
    const state = source?.getState?.();
    if (state) target?.setState?.(state);
}

export function createRayTracingCoordinator({ cpuCanvas, cpuFactory, onModeChange, onError } = {}) {
    if (!cpuCanvas) throw new Error('Ray tracing coordinator requires a CPU canvas.');
    if (typeof cpuFactory !== 'function') throw new Error('Ray tracing coordinator requires cpuFactory.');
    let rasterEngine = null;
    let cpuEngine = null;
    let cpuPromise = null;
    let mode = 'raster';
    let destroyed = false;
    let retainedAsset = null;
    let cpuLoadedAsset = null;
    let gpuLoadedAsset = null;
    let gpuLoadedEngine = null;
    let assetGeneration = 0;
    const releasedImages = new WeakSet();

    function releaseAssetImages(asset) {
        const source = asset?.source;
        const retainedSource = source?.rayTracing?.asset || source?.asset || source;
        for (const image of retainedSource?.images || []) {
            if (!image || (typeof image !== 'object' && typeof image !== 'function') || releasedImages.has(image)) continue;
            image.close?.();
            releasedImages.add(image);
        }
    }

    function capabilities() {
        const rasterCapabilities = rasterEngine?.getCapabilities?.() || {};
        return {
            raster: { available: !!rasterEngine },
            'raytrace-cpu': {
                available: typeof Worker !== 'undefined' && !!cpuCanvas.getContext,
                reason: typeof Worker === 'undefined' ? 'Web Workers are unavailable.' : undefined,
            },
            'raytrace-gpu': rasterCapabilities['raytrace-gpu'] || {
                available: false,
                reason: rasterEngine ? 'The active raster backend does not support GPU ray tracing.' : 'No raster engine is active.',
            },
            'hybrid-shadows': rasterCapabilities['hybrid-shadows'] || {
                available: false,
                reason: rasterEngine ? 'The active raster backend does not support hybrid shadows.' : 'No raster engine is active.',
            },
        };
    }

    async function ensureCpuEngine() {
        if (destroyed) throw new Error('Ray tracing coordinator has been destroyed.');
        if (cpuEngine) return cpuEngine;
        if (!cpuPromise) {
            cpuPromise = Promise.resolve(cpuFactory({ canvas: cpuCanvas, onError }))
                .then((engine) => {
                    if (destroyed) {
                        engine?.destroy?.();
                        throw new Error('Ray tracing coordinator was destroyed during CPU initialization.');
                    }
                    cpuEngine = engine;
                    return engine;
                })
                .finally(() => { cpuPromise = null; });
        }
        return cpuPromise;
    }

    function requireRetainedScene() {
        if (!retainedAsset) throw unsupportedMode('No ray-traceable scene asset is loaded.');
        return retainedAsset;
    }

    async function loadCpuAsset() {
        const asset = requireRetainedScene();
        const cpu = await ensureCpuEngine();
        if (asset !== retainedAsset) return cpu;
        if (cpuLoadedAsset !== asset) {
            if (typeof cpu.loadRayScene !== 'function') {
                throw unsupportedMode('The CPU renderer cannot load retained ray scenes.');
            }
            cpu.loadRayScene(asset.preparedRayScene);
            cpuLoadedAsset = asset;
        }
        return cpu;
    }

    async function loadGpuAsset() {
        const asset = requireRetainedScene();
        const engine = rasterEngine;
        if (gpuLoadedAsset !== asset || gpuLoadedEngine !== engine) {
            if (!engine?.loadRayScene) throw unsupportedMode('The active raster backend cannot load ray scenes.');
            await engine.loadRayScene(asset.preparedRayScene, { revisions: asset.revisions });
            // A slower obsolete load must not become the retained GPU scene.
            // Re-applying the newest asset is cheap when another request already won,
            // because the facade revision cache returns its existing drawable.
            if (!retainedAsset) return null;
            if (asset !== retainedAsset || engine !== rasterEngine) return loadGpuAsset();
            gpuLoadedAsset = asset;
            gpuLoadedEngine = engine;
        }
        return engine;
    }

    async function leaveCpuPresentation() {
        if (mode !== 'raytrace-cpu') return;
        copyCameraState(cpuEngine?.camera, rasterEngine?.camera);
        cpuEngine?.pause?.();
        rasterEngine?.scene?.resume?.();
    }

    async function leaveGpuPresentation(nextMode) {
        if ((mode === 'raytrace-gpu' || mode === 'hybrid-shadows') && nextMode === 'raytrace-cpu') {
            await rasterEngine?.setRenderMode?.('raster');
        }
    }

    return {
        getCapabilities: capabilities,
        setRasterEngine(engine) {
            rasterEngine = engine;
            gpuLoadedAsset = null;
            gpuLoadedEngine = null;
            if (mode === 'raytrace-cpu') rasterEngine?.scene?.pause?.();
        },
        async setSceneAsset(source) {
            if (destroyed) throw new Error('Ray tracing coordinator has been destroyed.');
            const generation = ++assetGeneration;
            const previousAsset = retainedAsset;
            retainedAsset = normalizeSceneAsset(source);
            if (previousAsset && previousAsset.source !== retainedAsset?.source) releaseAssetImages(previousAsset);
            cpuLoadedAsset = null;
            gpuLoadedAsset = null;
            gpuLoadedEngine = null;
            if (!retainedAsset) {
                if (mode === 'raytrace-cpu') {
                    cpuEngine?.pause?.();
                    rasterEngine?.scene?.resume?.();
                } else if (mode === 'raytrace-gpu' || mode === 'hybrid-shadows') {
                    await rasterEngine?.setRenderMode?.('raster');
                }
                if (mode !== 'raster') {
                    mode = 'raster';
                    onModeChange?.(mode);
                }
                return null;
            }
            if (mode === 'raytrace-cpu') {
                const cpu = await loadCpuAsset();
                if (generation !== assetGeneration) return retainedAsset;
                cpu.resume?.();
            } else if (mode === 'raytrace-gpu') {
                await loadGpuAsset();
                if (generation !== assetGeneration) return retainedAsset;
                await rasterEngine.setRenderMode('raytrace-gpu');
            }
            return retainedAsset;
        },
        async loadCornellBox(targetMode = 'raytrace-cpu') {
            if (targetMode === 'raytrace-gpu') {
                const gpuCapabilities = capabilities()['raytrace-gpu'];
                if (!gpuCapabilities.available || !rasterEngine?.loadCornellBox) {
                    throw unsupportedMode(gpuCapabilities.reason || 'GPU Cornell Box is unavailable.');
                }
                const drawable = await rasterEngine.loadCornellBox();
                const previousAsset = retainedAsset;
                retainedAsset = normalizeSceneAsset({
                    preparedRayScene: drawable?.scene || drawable?.preparedRayScene || drawable,
                    revisions: drawable?.revisions,
                });
                releaseAssetImages(previousAsset);
                assetGeneration += 1;
                cpuLoadedAsset = null;
                gpuLoadedAsset = retainedAsset;
                gpuLoadedEngine = rasterEngine;
                return retainedAsset.preparedRayScene;
            }
            const cpu = await ensureCpuEngine();
            const scene = cpu.loadCornellBox();
            const previousAsset = retainedAsset;
            retainedAsset = normalizeSceneAsset({ preparedRayScene: scene });
            releaseAssetImages(previousAsset);
            assetGeneration += 1;
            cpuLoadedAsset = retainedAsset;
            gpuLoadedAsset = null;
            gpuLoadedEngine = null;
            return scene;
        },
        async setRenderMode(nextMode) {
            if (!RENDER_MODES.has(nextMode)) throw unsupportedMode(`Unsupported render mode: ${nextMode}`);
            if (nextMode === mode) return;

            if (nextMode === 'raytrace-cpu') {
                const cpuCapabilities = capabilities()['raytrace-cpu'];
                if (!cpuCapabilities.available) throw unsupportedMode(cpuCapabilities.reason);
                requireRetainedScene();
                await leaveGpuPresentation(nextMode);
                const cpu = await loadCpuAsset();
                copyCameraState(rasterEngine?.camera, cpu.camera);
                rasterEngine?.scene?.pause?.();
                cpu.resume?.();
            } else if (nextMode === 'raytrace-gpu') {
                const gpuCapabilities = capabilities()['raytrace-gpu'];
                if (!gpuCapabilities.available) throw unsupportedMode(gpuCapabilities.reason);
                requireRetainedScene();
                const cpuCameraState = mode === 'raytrace-cpu' ? cpuEngine?.camera?.getState?.() : null;
                await leaveCpuPresentation();
                await loadGpuAsset();
                if (cpuCameraState) rasterEngine?.camera?.setState?.(cpuCameraState);
                await rasterEngine.setRenderMode('raytrace-gpu');
            } else if (nextMode === 'hybrid-shadows') {
                const hybridCapabilities = capabilities()['hybrid-shadows'];
                if (!hybridCapabilities.available) throw unsupportedMode(hybridCapabilities.reason);
                const cpuCameraState = mode === 'raytrace-cpu' ? cpuEngine?.camera?.getState?.() : null;
                await leaveCpuPresentation();
                if (cpuCameraState) rasterEngine?.camera?.setState?.(cpuCameraState);
                await rasterEngine.setRenderMode('hybrid-shadows');
            } else {
                await leaveCpuPresentation();
                if (RAY_MODES.has(mode) || mode === 'hybrid-shadows') {
                    await rasterEngine?.setRenderMode?.('raster');
                }
            }
            mode = nextMode;
            onModeChange?.(mode);
        },
        setRayTracingSettings(partial) {
            if (mode === 'raytrace-gpu') rasterEngine?.setRayTracingSettings?.(partial);
            else cpuEngine?.setSettings?.(partial);
        },
        setLight(light) {
            rasterEngine?.setLight?.(light);
        },
        resetAccumulation() {
            if (mode === 'raytrace-gpu') rasterEngine?.resetAccumulation?.();
            else cpuEngine?.resetAccumulation?.();
        },
        pause() {
            if (mode === 'raytrace-cpu') cpuEngine?.pause?.();
            else rasterEngine?.scene?.pause?.();
        },
        resume() {
            if (mode === 'raytrace-cpu') cpuEngine?.resume?.();
            else rasterEngine?.scene?.resume?.();
        },
        resize() {
            cpuEngine?.resize?.();
        },
        getRenderMode: () => mode,
        getSceneAsset: () => retainedAsset,
        getStats() {
            return mode === 'raytrace-cpu' ? cpuEngine?.getStats?.() : rasterEngine?.getStats?.();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            assetGeneration += 1;
            cpuEngine?.destroy?.();
            releaseAssetImages(retainedAsset);
            cpuEngine = null;
            rasterEngine = null;
            retainedAsset = null;
            cpuLoadedAsset = null;
            gpuLoadedAsset = null;
            gpuLoadedEngine = null;
        },
    };
}
