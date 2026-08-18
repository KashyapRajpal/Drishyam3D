/**
 * @file RadixSortBackend — exact back-to-front depth sort (4 x 8-bit LSD radix).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Drop-in alternative to BitonicSortBackend on the Sort axis: same SortBackend
 * contract, same maskKeys hook position, so SplatRenderer and the Culled
 * reduction are unchanged. O(N) work in ~13 dispatches with no power-of-two
 * padding, against bitonic's O(N log²N) over O(log²N) dispatches.
 *
 * Reuses compute_keys from splat-sort.wgsl verbatim — it already writes the f32
 * depth keys and seeds indices[i]=i, which is exactly what the radix wants. The
 * f32 key buffer stays the shared contract so apply_cull keeps masking it.
 * Algorithm mirrors ordering/radix-reference.js; see docs/splat-radix-sort.md.
 */
import { SortBackend } from './sort-backend.js';
import { createUniformBuffer } from '../webgpu-helpers.js';
import { createSortPipelines } from '../splat-helpers.js';
import { RADIX_BUCKETS, RADIX_PASSES, BLOCK_SIZE, alignUp } from './radix-reference.js';

const WORKGROUP_SIZE = 256;
const KEYS_PARAMS_SIZE = 80;   // view(64) + count(4) + padded(4) + pad(8) — matches KeysParams
const RADIX_PARAMS_SIZE = 32;  // padded, blockCount, pass, inBase, outBase + 3 pad
const PARAMS_STRIDE = 256;     // 256B-aligned slice per pass (minUniformBufferOffsetAlignment)

export class RadixSortBackend extends SortBackend {
    get name() { return 'radix'; }

    constructor(device) {
        super(device);
        this.keysPipeline = null;   // compute_keys, from splat-sort.wgsl
        this.pipelines = null;      // { encode, histogram, scan, scatter }
        this.bindGroupLayout = null;
        this.keysParamsBuffer = null;
        this.radixParamsBuffer = null;
        this.res = null;            // per-drawable buffers + bind groups
    }

    /** The sorted index buffer. Always the A half, at offset 0 — see run(). */
    get indexBuffer() { return this.res?.idxBuffer ?? null; }

    init() {
        this.keysParamsBuffer = createUniformBuffer(this.device, KEYS_PARAMS_SIZE);
        this.radixParamsBuffer = createUniformBuffer(this.device, RADIX_PASSES * PARAMS_STRIDE);
    }

    /**
     * @param {string} sortWgsl  splat-sort.wgsl — only compute_keys is used
     * @param {string} radixWgsl splat-radix-sort.wgsl
     */
    setShaders(sortWgsl, radixWgsl) {
        if (sortWgsl) this.keysPipeline = createSortPipelines(this.device, sortWgsl).keys;
        if (!radixWgsl) return;

        const { device } = this;
        // One explicit layout shared by all four radix pipelines, so a single set
        // of bind groups (one per pass, differing only in the uniform slice)
        // drives every dispatch. With layout:'auto' each entry point would derive
        // its own layout from the bindings it happens to touch.
        this.bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', minBindingSize: RADIX_PARAMS_SIZE } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        const module = device.createShaderModule({ code: radixWgsl });
        const stage = (entryPoint) => device.createComputePipeline({ layout, compute: { module, entryPoint } });

        this.pipelines = {
            encode: stage('encode_keys'),
            histogram: stage('histogram'),
            scan: stage('scan_hist'),
            scatter: stage('scatter'),
        };
        this._release();
    }

    prepare(drawable) {
        this._release();
        if (!drawable || drawable.kind !== 'splat' || !drawable.count) return;
        if (!this.keysPipeline || !this.pipelines || !this.keysParamsBuffer) return;

        const { device } = this;
        const count = drawable.count;
        const padded = alignUp(count, BLOCK_SIZE);
        const blockCount = padded / BLOCK_SIZE;

        // keysU32 and idx hold both ping-pong halves; inBase/outBase select one.
        const keysF32Buffer = device.createBuffer({
            size: padded * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const keysU32Buffer = device.createBuffer({
            size: padded * 2 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const idxBuffer = device.createBuffer({
            size: padded * 2 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        const histBuffer = device.createBuffer({
            size: RADIX_BUCKETS * blockCount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // Per-pass uniform slices. Pass p reads half (p%2) and writes the other,
        // so after an even RADIX_PASSES the result is back in half 0 — which is
        // what keeps the renderer's bind group (bound to idxBuffer at offset 0)
        // valid without a copy-back.
        const params = new Uint32Array(RADIX_PASSES * (PARAMS_STRIDE / 4));
        for (let p = 0; p < RADIX_PASSES; p++) {
            const base = p * (PARAMS_STRIDE / 4);
            params[base + 0] = padded;
            params[base + 1] = blockCount;
            params[base + 2] = p;
            params[base + 3] = p % 2 === 0 ? 0 : padded;      // inBase
            params[base + 4] = p % 2 === 0 ? padded : 0;      // outBase
        }
        device.queue.writeBuffer(this.radixParamsBuffer, 0, params);

        const bindGroups = [];
        for (let p = 0; p < RADIX_PASSES; p++) {
            bindGroups.push(device.createBindGroup({
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.radixParamsBuffer, offset: p * PARAMS_STRIDE, size: RADIX_PARAMS_SIZE } },
                    { binding: 1, resource: { buffer: keysF32Buffer } },
                    { binding: 2, resource: { buffer: keysU32Buffer } },
                    { binding: 3, resource: { buffer: idxBuffer } },
                    { binding: 4, resource: { buffer: histBuffer } },
                ],
            }));
        }

        // compute_keys writes the f32 keys and seeds indices[i]=i into half 0.
        const keysBindGroup = device.createBindGroup({
            layout: this.keysPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.keysParamsBuffer } },
                { binding: 1, resource: { buffer: drawable.storageBuffer } },
                { binding: 2, resource: { buffer: keysF32Buffer } },
                { binding: 3, resource: { buffer: idxBuffer, offset: 0, size: padded * 4 } },
            ],
        });

        this.res = {
            keysF32Buffer, keysU32Buffer, idxBuffer, histBuffer,
            bindGroups, keysBindGroup, padded, blockCount,
        };
    }

    /**
     * Records compute_keys → the reduction's key-mask hook → encode → 4 radix
     * passes. Every radix dispatch shares one compute pass: WebGPU orders
     * dispatches within a pass and synchronises storage writes between them, so
     * no explicit barriers are needed and the whole sort wears a single 'sort'
     * timestamp span — directly comparable to bitonic's.
     * @returns {{ indexBuffer: GPUBuffer, count: number, indirect: GPUBuffer|null }}
     */
    run(frame, drawable, reduction) {
        const { device, encoder, viewMatrix } = frame;
        if (!this.res || !this.pipelines || !drawable.count) {
            return { indexBuffer: this.indexBuffer, count: drawable.count, indirect: null };
        }

        const { padded, blockCount, bindGroups, keysBindGroup } = this.res;

        // Keys params: view + count + padded (same struct the bitonic path uses).
        const keysParams = new ArrayBuffer(KEYS_PARAMS_SIZE);
        new Float32Array(keysParams).set(viewMatrix, 0);
        const ku = new Uint32Array(keysParams);
        ku[16] = drawable.count;
        ku[17] = padded;
        device.queue.writeBuffer(this.keysParamsBuffer, 0, keysParams);

        // Pass 1: depth keys + identity indices (untimed, exactly as bitonic
        // leaves it — so the 'sort' spans measure the same scope on both).
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.keysPipeline);
            pass.setBindGroup(0, keysBindGroup);
            pass.dispatchWorkgroups(Math.ceil(padded / WORKGROUP_SIZE));
            pass.end();
        }

        // Reduction hook: mask culled keys in the f32 buffer, count visible
        // instances. Same position as in the bitonic backend, so Culled composes
        // without knowing which sort is active.
        let indirect = null;
        if (reduction && typeof reduction.maskKeys === 'function') {
            indirect = reduction.maskKeys(frame, {
                keyBuffer: this.res.keysF32Buffer,
                splatBuffer: drawable.storageBuffer,
                count: drawable.count,
            });
        }

        // Pass 2: encode + 4 x (histogram → scan → scatter), timed as 'sort'.
        {
            const ts = frame.gpuTimer?.span('sort');
            const pass = encoder.beginComputePass(ts ? { timestampWrites: ts } : {});

            pass.setPipeline(this.pipelines.encode);
            pass.setBindGroup(0, bindGroups[0]); // slice 0 targets half 0
            pass.dispatchWorkgroups(Math.ceil(padded / WORKGROUP_SIZE));

            for (let p = 0; p < RADIX_PASSES; p++) {
                pass.setBindGroup(0, bindGroups[p]);
                pass.setPipeline(this.pipelines.histogram);
                pass.dispatchWorkgroups(blockCount);
                pass.setPipeline(this.pipelines.scan);
                pass.dispatchWorkgroups(1);
                pass.setPipeline(this.pipelines.scatter);
                pass.dispatchWorkgroups(blockCount);
            }
            pass.end();
        }

        return { indexBuffer: this.res.idxBuffer, count: drawable.count, indirect };
    }

    _release() {
        if (!this.res) return;
        this.res.keysF32Buffer?.destroy?.();
        this.res.keysU32Buffer?.destroy?.();
        this.res.idxBuffer?.destroy?.();
        this.res.histBuffer?.destroy?.();
        this.res = null;
    }

    releaseDrawable() {
        this._release();
    }

    destroy() {
        this._release();
        this.keysParamsBuffer?.destroy?.();
        this.radixParamsBuffer?.destroy?.();
    }
}
