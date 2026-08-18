/**
 * @file GpuTimer — per-pass GPU timing via timestamp queries.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Brackets named passes with a timestamp pair, resolves them once per frame, and
 * reads the durations back through a small ring of readback buffers. Compute and
 * render passes take the same `timestampWrites` shape, so span() serves both.
 * Feature-gated on 'timestamp-query'; when unavailable every span() returns null
 * and callers fall back to an untimed pass. WebGPU timestamps are nanoseconds, so
 * a pair's delta / 1e6 is milliseconds.
 *
 * Two properties this deliberately guarantees, both learned the hard way — the
 * previous single-buffer version reported byte-identical timings for 60 seconds
 * across a backend switch on a 3.5M-splat scene, which silently invalidated every
 * measurement taken through it:
 *
 *   1. **A slow or hung readback cannot stall timing.** Buffers are used from a
 *      ring; a frame whose slots are all still mapped is skipped, not queued
 *      behind them. One wedged map costs one slot, not the instrument.
 *   2. **A stale sample is never served as if it were current.** Every reading
 *      carries the time it landed, and `getDurations()` omits anything older than
 *      the stale window (which scales with frame cadence — see below). Callers
 *      see a missing value — which they can render as "—" — instead of a
 *      plausible number that stopped tracking reality.
 *
 * Span names are captured per slot, so a frame that assigns spans in a different
 * order can never have its timings attributed to the previous frame's names.
 */

/** Readback buffers in flight. Enough to cover a map that takes a few frames. */
const SLOT_COUNT = 3;

/**
 * Freshness floor, and how many frames of slack to allow beyond it.
 *
 * "Stale" has to mean "several frames have passed with no update", not a fixed
 * wall-clock age: a 3.5M-splat scene runs at ~1.5 s/frame, where a flat 2 s
 * window is barely one frame and withholds every reading. The window is
 * therefore max(floor, SLACK x recent frame interval).
 */
const STALE_FLOOR_MS = 2000;
const STALE_FRAME_SLACK = 4;

export class GpuTimer {
    /**
     * @param {GPUDevice} device
     * @param {number} maxSpans max timed passes per frame
     * @param {() => number} now injectable clock (ms), for tests
     */
    constructor(device, maxSpans = 4, now = () => performance.now()) {
        this.device = device;
        this.enabled = device.features?.has?.('timestamp-query') ?? false;
        this.maxSpans = maxSpans;
        this._now = now;
        this._spanNames = [];
        this._samples = {};   // name -> { ms, at }
        this._frameMs = null;    // smoothed frame interval, for the stale window
        this._lastFrameAt = null;
        this._slots = [];     // { buffer, busy, names }
        this._armed = null;   // slot awaiting its post-submit map
        this.skippedFrames = 0;

        if (this.enabled) {
            const size = maxSpans * 2 * 8;
            this.querySet = device.createQuerySet({ type: 'timestamp', count: maxSpans * 2 });
            this.resolveBuffer = device.createBuffer({
                size,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            for (let i = 0; i < SLOT_COUNT; i++) {
                this._slots.push({
                    buffer: device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
                    busy: false,
                    names: [],
                });
            }
        }
    }

    /** Reset this frame's span assignments. Call at the top of each frame. */
    beginFrame() {
        this._spanNames = [];
        // Track frame cadence so the freshness window can scale with it.
        const t = this._now();
        if (this._lastFrameAt != null) {
            const dt = t - this._lastFrameAt;
            // Smoothed, so one hitch doesn't widen the window for long.
            this._frameMs = this._frameMs == null ? dt : this._frameMs * 0.8 + dt * 0.2;
        }
        this._lastFrameAt = t;
    }

    /** How old a reading may be before it is withheld. */
    _staleWindowMs() {
        return Math.max(STALE_FLOOR_MS, (this._frameMs ?? 0) * STALE_FRAME_SLACK);
    }

    /**
     * Reserve a timestamp pair for a named pass. Use as
     * `encoder.beginComputePass({ timestampWrites: timer.span('sort') })`, or the
     * same on `beginRenderPass`.
     * Returns null when timing is off or the per-frame budget is spent.
     * @returns {GPUComputePassTimestampWrites|GPURenderPassTimestampWrites|null}
     */
    span(name) {
        if (!this.enabled || this._spanNames.length >= this.maxSpans) return null;
        const i = this._spanNames.length;
        this._spanNames.push(name);
        return {
            querySet: this.querySet,
            beginningOfPassWriteIndex: i * 2,
            endOfPassWriteIndex: i * 2 + 1,
        };
    }

    /**
     * Resolve this frame's timestamps into a free readback slot. Call before
     * submit. When every slot is still mapped the frame is skipped — timing
     * degrades to a lower sample rate rather than stalling or lying.
     */
    resolve(encoder) {
        if (!this.enabled || this._spanNames.length === 0) return;
        const slot = this._slots.find((s) => !s.busy);
        if (!slot) {
            this.skippedFrames++;
            return;
        }
        const n = this._spanNames.length;
        encoder.resolveQuerySet(this.querySet, 0, n * 2, this.resolveBuffer, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer, 0, slot.buffer, 0, n * 2 * 8);
        // Names travel with the slot, so a later frame's span order can't be
        // applied to this frame's timings.
        slot.names = this._spanNames.slice();
        slot.busy = true;
        this._armed = slot;
    }

    /** Map + read the armed slot. Call after submit; never awaited by the caller. */
    readback() {
        const slot = this._armed;
        this._armed = null;
        if (!slot) return;

        slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
            // Timestamps are u64 nanoseconds — read unsigned so large values
            // aren't misread as negative, and compare before subtracting to
            // avoid unsigned wrap.
            const ticks = new BigUint64Array(slot.buffer.getMappedRange().slice(0));
            slot.buffer.unmap();
            const at = this._now();
            for (let i = 0; i < slot.names.length; i++) {
                const begin = ticks[i * 2];
                const end = ticks[i * 2 + 1];
                if (end >= begin) this._samples[slot.names[i]] = { ms: Number(end - begin) / 1e6, at };
            }
        }).catch(() => {
            /* mapping race / device lost — drop this sample, keep the slot usable */
        }).then(() => {
            slot.busy = false;
        });
    }

    /**
     * Fresh durations in ms, keyed by span name (e.g. `{ sort, render }`).
     * Readings older than the stale window are omitted rather than served as
     * current, so an absent key means "no recent measurement", never "zero".
     */
    getDurations() {
        const cutoff = this._now() - this._staleWindowMs();
        const out = {};
        for (const name of Object.keys(this._samples)) {
            const sample = this._samples[name];
            if (sample.at >= cutoff) out[name] = sample.ms;
        }
        return out;
    }

    destroy() {
        this.querySet?.destroy?.();
        this.resolveBuffer?.destroy?.();
        for (const slot of this._slots) slot.buffer?.destroy?.();
        this._slots = [];
        this._armed = null;
    }
}
