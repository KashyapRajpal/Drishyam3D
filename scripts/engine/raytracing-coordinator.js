export function createRayTracingCoordinator({ cpuCanvas, cpuFactory, onModeChange, onError } = {}) {
    if (!cpuCanvas) throw new Error('Ray tracing coordinator requires a CPU canvas.');
    if (typeof cpuFactory !== 'function') throw new Error('Ray tracing coordinator requires cpuFactory.');
    let rasterEngine = null;
    let cpuEngine = null;
    let cpuPromise = null;
    let mode = 'raster';
    let destroyed = false;
    let cornellLoaded = false;

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
        getCapabilities() {
            return {
                raster: { available: !!rasterEngine },
                'raytrace-cpu': {
                    available: typeof Worker !== 'undefined' && !!cpuCanvas.getContext,
                    reason: typeof Worker === 'undefined' ? 'Web Workers are unavailable.' : undefined,
                },
            };
        },
        setRasterEngine(engine) {
            rasterEngine = engine;
            if (mode === 'raytrace-cpu') rasterEngine?.scene?.pause?.();
        },
        async loadCornellBox() {
            const cpu = await ensureCpuEngine();
            const scene = cpu.loadCornellBox();
            cornellLoaded = true;
            return scene;
        },
        async setRenderMode(nextMode) {
            if (nextMode !== 'raster' && nextMode !== 'raytrace-cpu') {
                const error = new Error(`Unsupported render mode: ${nextMode}`);
                error.code = 'UNSUPPORTED_RENDER_MODE';
                throw error;
            }
            if (nextMode === mode) return;
            if (nextMode === 'raytrace-cpu') {
                const capabilities = this.getCapabilities()['raytrace-cpu'];
                if (!capabilities.available) {
                    const error = new Error(capabilities.reason);
                    error.code = 'UNSUPPORTED_RENDER_MODE';
                    throw error;
                }
                const cpu = await ensureCpuEngine();
                if (!cornellLoaded) {
                    cpu.loadCornellBox();
                    cornellLoaded = true;
                }
                rasterEngine?.scene?.pause?.();
                cpu.resume();
            } else {
                cpuEngine?.pause?.();
                rasterEngine?.scene?.resume?.();
            }
            mode = nextMode;
            onModeChange?.(mode);
        },
        setRayTracingSettings(partial) {
            cpuEngine?.setSettings?.(partial);
        },
        resetAccumulation() {
            cpuEngine?.resetAccumulation?.();
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
