/**
 * @file GpuTimer — per-pass GPU timing via timestamp queries.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Brackets named compute passes with a timestamp pair, resolves them once per
 * frame, and reads the durations back single-flight (never mapping a buffer
 * that's still in flight). Feature-gated on 'timestamp-query'; when unavailable
 * every span() returns null and callers fall back to an untimed pass.
 * WebGPU timestamp values are nanoseconds, so a pair's delta / 1e6 is milliseconds.
 */
export class GpuTimer {
    /** @param {GPUDevice} device @param {number} maxSpans max timed passes per frame */
    constructor(device, maxSpans = 4) {
        this.device = device;
        this.enabled = device.features?.has?.('timestamp-query') ?? false;
        this.maxSpans = maxSpans;
        this._spanNames = [];
        this._durations = {}; // name -> ms (last successful read)
        this._pending = false; // a readback map is in flight

        if (this.enabled) {
            this.querySet = device.createQuerySet({ type: 'timestamp', count: maxSpans * 2 });
            this.resolveBuffer = device.createBuffer({
                size: maxSpans * 2 * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.readBuffer = device.createBuffer({
                size: maxSpans * 2 * 8,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }
    }

    /** Reset this frame's span assignments. Call at the top of each frame. */
    beginFrame() {
        this._spanNames = [];
    }

    /**
     * Reserve a timestamp pair for a named pass. Use as
     * `encoder.beginComputePass({ timestampWrites: timer.span('sort') })`.
     * Compute and render passes take the same timestampWrites shape, so this
     * works for `beginRenderPass` too.
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

    /** Resolve this frame's timestamps into the readback buffer. Call before submit. */
    resolve(encoder) {
        if (!this.enabled || this._spanNames.length === 0 || this._pending) return;
        const n = this._spanNames.length;
        encoder.resolveQuerySet(this.querySet, 0, n * 2, this.resolveBuffer, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, n * 2 * 8);
    }

    /** Map + read durations. Call after submit; safe to not await (single-flight). */
    async readback() {
        if (!this.enabled || this._pending || this._spanNames.length === 0) return;
        const names = this._spanNames.slice();
        this._pending = true;
        try {
            await this.readBuffer.mapAsync(GPUMapMode.READ);
            // Timestamps are u64 nanoseconds — read unsigned so large values aren't
            // misread as negative. Compare before subtracting to avoid unsigned wrap.
            const ticks = new BigUint64Array(this.readBuffer.getMappedRange().slice(0));
            this.readBuffer.unmap();
            for (let i = 0; i < names.length; i++) {
                const begin = ticks[i * 2];
                const end = ticks[i * 2 + 1];
                if (end >= begin) this._durations[names[i]] = Number(end - begin) / 1e6;
            }
        } catch (e) {
            /* mapping race / device lost — drop this sample */
        } finally {
            this._pending = false;
        }
    }

    /** Last measured durations in ms, keyed by span name (e.g. { sort, reduce }). */
    getDurations() {
        return { ...this._durations };
    }

    destroy() {
        this.querySet?.destroy?.();
        this.resolveBuffer?.destroy?.();
        this.readBuffer?.destroy?.();
    }
}
