/**
 * @file NoneReduction — passthrough reduction (no set reduction).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * The identity element of axis 1 (see docs/splat-ordering.md): every splat is
 * kept and the SortBackend seeds its own identity indices, so None + Bitonic is
 * exactly the baseline renderer.
 */
import { ReductionStage } from './reduction-stage.js';

export class NoneReduction extends ReductionStage {
    get name() { return 'none'; }
    // Inherits the base no-op maskKeys() (returns null) → the sort runs untouched
    // and the renderer draws all splats.
}
