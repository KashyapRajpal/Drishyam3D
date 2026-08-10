/**
 * @file Web Worker entry point for off-main-thread splat processing.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * A thin message wrapper around `createSplatPipeline` — all the parsing/packing
 * logic lives in the pure, Jest-tested pipeline. Parsing a million-splat `.ply`
 * (parse + mirror + covariance pack) runs here so the main thread never blocks.
 *
 * Protocol (request carries an `id`, echoed on the response):
 *   -> { id, type: 'load',    buffer: ArrayBuffer, flipY: boolean }
 *   -> { id, type: 'setFlip', flipY: boolean }
 *   <- { id, ok: true,  payload: object|null }   // null = no re-pack needed
 *   <- { id, ok: false, error: string }
 * Payload typed arrays are transferred (zero-copy); see `payloadTransferables`.
 *
 * NOTE: no `import.meta` here — this module is bundled as a worker by Vite via
 * the literal `new Worker(new URL(...))` in splat-loader-client.js.
 */

import { createSplatPipeline, payloadTransferables } from './splat-pipeline.js';

const pipeline = createSplatPipeline();

self.onmessage = (event) => {
    const { id, type, buffer, flipY } = event.data ?? {};
    try {
        let payload;
        if (type === 'load') {
            payload = pipeline.load(buffer, flipY);
        } else if (type === 'setFlip') {
            payload = pipeline.setFlip(flipY);
        } else {
            throw new Error(`Unknown splat worker message type: ${type}`);
        }
        self.postMessage({ id, ok: true, payload }, payloadTransferables(payload));
    } catch (err) {
        self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
    }
};
