/** Kept isolated because Jest's Babel graph cannot parse import.meta. */
export function createCpuRayWorker() {
    return new Worker(new URL('./cpu-ray-worker.js', import.meta.url), { type: 'module' });
}
