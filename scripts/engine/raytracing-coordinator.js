export function createRayTracingCoordinator({ cpuCanvas, cpuFactory, onModeChange, onError } = {}) {
    if (!cpuCanvas) throw new Error('Ray tracing coordinator requires a CPU canvas.');
    if (typeof cpuFactory !== 'function') throw new Error('Ray tracing coordinator requires cpuFactory.');
    let rasterEngine = null;
    let cpuEngine = null;
    let cpuPromise = null;
    let mode = 'raster';
    let destroyed = false;
    let cpuCornellLoaded = false;
    let gpuCornellLoaded = false;

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

    return {
        getCapabilities: capabilities,
        setRasterEngine(engine) {
            rasterEngine = engine;
            gpuCornellLoaded = false;
            if (mode === 'raytrace-cpu') rasterEngine?.scene?.pause?.();
        },
        async loadCornellBox(targetMode = 'raytrace-cpu') {
            if (targetMode === 'raytrace-gpu') {
                const gpuCapabilities = capabilities()['raytrace-gpu'];
                if (!gpuCapabilities.available || !rasterEngine?.loadCornellBox) {
                    const error = new Error(gpuCapabilities.reason || 'GPU Cornell Box is unavailable.');
                    error.code = 'UNSUPPORTED_RENDER_MODE';
                    throw error;
                }
                const scene = await rasterEngine.loadCornellBox();
                gpuCornellLoaded = true;
                return scene;
            }
            const cpu = await ensureCpuEngine();
            const scene = cpu.loadCornellBox();
            cpuCornellLoaded = true;
            return scene;
        },
        async setRenderMode(nextMode) {
            if (nextMode !== 'raster' && nextMode !== 'raytrace-cpu' && nextMode !== 'raytrace-gpu') {
                const error = new Error(`Unsupported render mode: ${nextMode}`);
                error.code = 'UNSUPPORTED_RENDER_MODE';
                throw error;
            }
            if (nextMode === mode) return;
            if (nextMode === 'raytrace-cpu') {
                const cpuCapabilities = capabilities()['raytrace-cpu'];
                if (!cpuCapabilities.available) {
                    const error = new Error(cpuCapabilities.reason);
                    error.code = 'UNSUPPORTED_RENDER_MODE';
                    throw error;
                }
                const cpu = await ensureCpuEngine();
                if (!cpuCornellLoaded) {
                    cpu.loadCornellBox();
                    cpuCornellLoaded = true;
                }
                if (mode === 'raytrace-gpu') await rasterEngine?.setRenderMode?.('raster');
                rasterEngine?.scene?.pause?.();
                cpu.resume();
            } else if (nextMode === 'raytrace-gpu') {
                const gpuCapabilities = capabilities()['raytrace-gpu'];
                if (!gpuCapabilities.available) {
                    const error = new Error(gpuCapabilities.reason);
                    error.code = 'UNSUPPORTED_RENDER_MODE';
                    throw error;
                }
                if (!gpuCornellLoaded) {
                    await rasterEngine.loadCornellBox();
                    gpuCornellLoaded = true;
                }
                cpuEngine?.pause?.();
                rasterEngine?.scene?.resume?.();
                await rasterEngine.setRenderMode('raytrace-gpu');
            } else {
                cpuEngine?.pause?.();
                if (mode === 'raytrace-gpu') await rasterEngine?.setRenderMode?.('raster');
                rasterEngine?.scene?.resume?.();
            }
            mode = nextMode;
            onModeChange?.(mode);
        },
        setRayTracingSettings(partial) {
            if (mode === 'raytrace-gpu') rasterEngine?.setRayTracingSettings?.(partial);
            else cpuEngine?.setSettings?.(partial);
        },
        resetAccumulation() {
            if (mode === 'raytrace-gpu') rasterEngine?.resetAccumulation?.();
            else cpuEngine?.resetAccumulation?.();
        },
        resize() {
            cpuEngine?.resize?.();
        },
        getRenderMode: () => mode,
        getStats() {
            return mode === 'raytrace-cpu' ? cpuEngine?.getStats?.() : rasterEngine?.getStats?.();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            cpuEngine?.destroy?.();
            cpuEngine = null;
            rasterEngine = null;
        },
    };
}
