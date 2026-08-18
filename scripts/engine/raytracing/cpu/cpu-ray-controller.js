export function createCpuRayController({ workerFactory, presentTile, onStats, onError } = {}) {
    if (typeof workerFactory !== 'function') throw new Error('CPU ray controller requires workerFactory.');
    if (typeof presentTile !== 'function') throw new Error('CPU ray controller requires presentTile.');
    const worker = workerFactory();
    if (!worker) throw new Error('CPU ray worker could not be created.');

    let generation = 0;
    let ready = false;
    let running = false;
    let destroyed = false;
    let passIndex = 0;
    let renderRequest = null;
    let retained = null;
    let stats = {
        backend: 'cpu', renderMode: 'raytrace-cpu', spp: 0,
        raysPerSecond: 0, frameMs: 0, rays: 0,
    };

    function post(message) {
        if (!destroyed) worker.postMessage(message);
    }

    function reportError(error) {
        running = false;
        onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    function requestPass() {
        if (!ready || !running || !renderRequest || destroyed) return;
        post({ type: 'render', generation, passIndex, ...renderRequest });
    }

    worker.onmessage = (event) => {
        const message = event.data || {};
        if (destroyed || message.generation !== generation) return;
        if (message.type === 'ready') {
            ready = true;
            requestPass();
        } else if (message.type === 'tile') {
            presentTile(message);
        } else if (message.type === 'pass-complete') {
            stats = {
                ...stats,
                spp: message.spp,
                frameMs: message.elapsedMs,
                rays: message.rays,
                raysPerSecond: message.elapsedMs > 0 ? Math.round(message.rays * 1000 / message.elapsedMs) : 0,
            };
            passIndex += 1;
            onStats?.({ ...stats });
            requestPass();
        } else if (message.type === 'error') {
            const error = new Error(message.message || 'CPU ray worker failed.');
            if (message.stack) error.stack = message.stack;
            reportError(error);
        }
    };
    worker.onerror = (event) => reportError(new Error(event?.message || 'CPU ray worker crashed.'));
    worker.onmessageerror = () => reportError(new Error('CPU ray worker message could not be deserialized.'));

    function initialize(preparedScene, acceleration, settings = {}) {
        if (destroyed) throw new Error('CPU ray controller has been destroyed.');
        const oldGeneration = generation;
        generation += 1;
        ready = false;
        passIndex = 0;
        stats = { ...stats, spp: 0, raysPerSecond: 0, frameMs: 0, rays: 0 };
        retained = { preparedScene, acceleration, settings: { ...settings } };
        if (oldGeneration > 0) post({ type: 'cancel', generation: oldGeneration });
        post({ type: 'init', generation, ...retained });
        return generation;
    }

    return {
        initialize,
        render(request) {
            if (!retained) throw new Error('CPU ray controller must be initialized before render.');
            renderRequest = { tileSize: 32, ...request };
            running = true;
            requestPass();
        },
        reset(nextRenderRequest) {
            if (!retained) return;
            const wasRunning = running;
            if (nextRenderRequest) renderRequest = { tileSize: 32, ...nextRenderRequest };
            initialize(retained.preparedScene, retained.acceleration, retained.settings);
            running = wasRunning;
        },
        pause() {
            if (!running || destroyed) return;
            running = false;
            post({ type: 'cancel', generation });
        },
        resume() {
            if (destroyed || running || !retained) return;
            running = true;
            // A cancelled partial pass cannot share a uniform SPP count; restart cleanly.
            initialize(retained.preparedScene, retained.acceleration, retained.settings);
        },
        getStats: () => ({ ...stats }),
        getGeneration: () => generation,
        destroy() {
            if (destroyed) return;
            running = false;
            destroyed = true;
            generation += 1;
            worker.postMessage({ type: 'destroy' });
            worker.terminate?.();
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            retained = null;
        },
    };
}
