/**
 * @file Main-thread client for the splat-processing Web Worker.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Owns the Worker instance and correlates request/response messages by id,
 * exposing a promise-based `load`/`setFlip` API. When Workers are unavailable
 * (or construction fails) it transparently falls back to running the same pure
 * pipeline synchronously on the calling thread — the API stays async either way.
 *
 * This module is the ONLY place that touches `import.meta` (via the literal
 * `new Worker(new URL('./splat-worker.js', import.meta.url), ...)` that Vite
 * statically rewrites). webgpu-facade.js imports it *dynamically* so it never
 * enters Jest's babel graph, which cannot parse `import.meta` (cf. geometry.js).
 */

import { createSplatPipeline } from './splat-pipeline.js';

/**
 * @returns {{
 *   load: (arrayBuffer: ArrayBuffer, flipY: boolean) => Promise<object>,
 *   setFlip: (flipY: boolean) => Promise<object|null>,
 *   destroy: () => void,
 * }}
 */
export function createSplatLoaderClient() {
    let worker = null;
    let inline = null; // synchronous fallback pipeline
    let nextId = 1;
    const pending = new Map();

    function useInline() {
        inline = createSplatPipeline();
    }

    function ensureBackend() {
        if (worker || inline) return;
        if (typeof Worker === 'undefined') {
            useInline();
            return;
        }
        try {
            worker = new Worker(new URL('./splat-worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (event) => {
                const { id, ok, payload, error } = event.data ?? {};
                const entry = pending.get(id);
                if (!entry) return;
                pending.delete(id);
                if (ok) entry.resolve(payload);
                else entry.reject(new Error(error || 'Splat worker failed.'));
            };
            // A worker-level error (e.g. bundling/import failure) would otherwise
            // leave every request hanging forever — reject them all.
            const failAll = (message) => {
                const err = new Error(message);
                for (const entry of pending.values()) entry.reject(err);
                pending.clear();
            };
            worker.onerror = (event) => failAll(event?.message || 'Splat worker crashed.');
            worker.onmessageerror = () => failAll('Splat worker message could not be deserialized.');
        } catch {
            worker = null;
            useInline();
        }
    }

    function request(type, { buffer, flipY }) {
        ensureBackend();
        if (inline) {
            // Same pipeline, run synchronously; keep the async contract.
            try {
                const payload = type === 'load' ? inline.load(buffer, flipY) : inline.setFlip(flipY);
                return Promise.resolve(payload);
            } catch (err) {
                return Promise.reject(err);
            }
        }
        return new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            // Transfer the source buffer into the worker to avoid a copy (the
            // caller does not reuse it). setFlip has no buffer to transfer.
            const transfer = type === 'load' && buffer ? [buffer] : [];
            worker.postMessage({ id, type, buffer, flipY }, transfer);
        });
    }

    return {
        load(arrayBuffer, flipY) {
            return request('load', { buffer: arrayBuffer, flipY });
        },
        setFlip(flipY) {
            return request('setFlip', { flipY });
        },
        destroy() {
            if (worker) worker.terminate();
            worker = null;
            inline = null;
            pending.clear();
        },
    };
}
