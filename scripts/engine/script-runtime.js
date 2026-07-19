/**
 * @file Shared runtime for compiling user-authored scene scripts.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 *
 * SECURITY: This module is the single place where user script source is turned
 * into executable code via `new Function`. User scripts run with full access to
 * the page's global scope (window, fetch, etc.) and are only sandboxed from the
 * engine internals by the explicit argument list below. Keep this the ONLY
 * construction site so the trust boundary lives in one place. If scene scripts
 * ever become loadable from an untrusted source (shared URLs, remote/community
 * scenes), move execution into a Web Worker or sandboxed iframe before doing so.
 */

import { translateMatrix, rotateMatrix } from './matrix.js';

/**
 * Compiles user scene-script source into a validated `{ init, update }` module.
 *
 * The script is given exactly three bindings: `translateMatrix`, `rotateMatrix`,
 * and the active `camera`. It must define top-level `init` and `update` functions.
 *
 * @param {string} source Raw user script source.
 * @param {{ camera: object }} context Per-engine runtime bindings.
 * @returns {{ init: Function, update: Function }} The validated script module.
 * @throws {Error} If the source is empty or does not export init/update functions.
 */
export function compileUserScript(source, { camera }) {
    if (!source) {
        throw new Error('Script source is empty.');
    }

    const scriptModule = new Function(
        'translateMatrix',
        'rotateMatrix',
        'camera',
        `${source}\n return { init, update };`
    )(translateMatrix, rotateMatrix, camera);

    if (!scriptModule || typeof scriptModule.init !== 'function' || typeof scriptModule.update !== 'function') {
        throw new Error("Script must export 'init' and 'update' functions.");
    }

    return scriptModule;
}
