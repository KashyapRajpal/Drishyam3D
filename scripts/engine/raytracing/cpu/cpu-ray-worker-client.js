/**
 * Kept isolated because Jest's Babel graph cannot parse import.meta. Browser
 * entry points should import this factory statically so their bundler owns the
 * worker URL instead of fetching this module through a runtime `/@fs/` URL.
 */
export function createCpuRayWorker() {
    return new Worker(new URL('./cpu-ray-worker.js', import.meta.url), { type: 'module' });
}
