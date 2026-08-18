/**
 * @file Stateful splat-processing pipeline: parse -> (optional) mirror -> pack.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Pure (no GPU, no Worker, no `import.meta`) so it runs identically on the main
 * thread, inside `splat-worker.js`, and under Jest. It retains the parsed cloud
 * so the Y-flip can be toggled and re-packed without re-parsing the file.
 *
 * The output `payload` carries everything the GPU side needs (see
 * webgpu-facade.js `buildSplatDrawable`): the interleaved `packed` buffer, the
 * source-degree SH coefficients (the device's storage limit is only known on the
 * main thread, so degree fitting happens there), plus `count`/`bounds`/`positions`.
 */

import { parsePly, mirrorYInPlace, normalizeInPlace } from './ply-loader.js';
import { packSplats } from './splat-helpers.js';

/**
 * ArrayBuffers in a payload that can be transferred (zero-copy) across a
 * `postMessage` boundary. The pipeline keeps its own `splatData`, so every array
 * here is either freshly allocated (`packed`) or a copy — safe to hand off.
 * @param {ReturnType<ReturnType<typeof createSplatPipeline>['load']>} payload
 * @returns {ArrayBuffer[]}
 */
export function payloadTransferables(payload) {
    if (!payload) return [];
    const transfers = [payload.packed.buffer, payload.positions.buffer];
    if (payload.shCoeffs) transfers.push(payload.shCoeffs.buffer);
    return transfers;
}

/**
 * Creates a pipeline that owns one parsed splat cloud at a time.
 * @returns {{
 *   load: (arrayBuffer: ArrayBuffer, flipY: boolean) => object,
 *   setFlip: (flipY: boolean) => object|null,
 * }}
 */
export function createSplatPipeline() {
    let splatData = null;
    let flipped = false;

    // Build a transferable payload from the current `splatData`. `packed` is
    // freshly allocated each call; `positions`/`shCoeffs` are copied so the
    // retained cloud survives the transfer and can still be re-flipped.
    function buildPayload() {
        return {
            packed: packSplats(splatData),
            positions: splatData.positions.slice(),
            shCoeffs: splatData.shCoeffs ? splatData.shCoeffs.slice() : null,
            shDegree: splatData.shDegree,
            count: splatData.count,
            bounds: splatData.bounds,
            // Original world frame, so callers can map back out of the
            // normalized space (see normalizeInPlace).
            sourceTransform: splatData.sourceTransform ?? null,
        };
    }

    return {
        load(arrayBuffer, flipY) {
            splatData = parsePly(arrayBuffer);
            flipped = false;
            if (flipY) {
                mirrorYInPlace(splatData);
                flipped = true;
            }
            // After the flip, so the cloud is already in its final orientation
            // and setFlip() then mirrors an origin-centered cloud about its own
            // center — which is what the toggle means anyway.
            normalizeInPlace(splatData);
            return buildPayload();
        },

        // Returns null (no re-pack needed) when there is no cloud or the flip
        // state already matches. mirrorYInPlace is its own inverse.
        setFlip(flipY) {
            const want = !!flipY;
            if (!splatData || want === flipped) return null;
            mirrorYInPlace(splatData);
            flipped = want;
            return buildPayload();
        },
    };
}
