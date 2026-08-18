import { GpuTimer } from '../scripts/engine/gpu-timer.js';

// WebGPU constants are browser globals; stub them as splat-helpers.test.js does.
beforeEach(() => {
  global.GPUBufferUsage = { COPY_SRC: 0x04, COPY_DST: 0x08, QUERY_RESOLVE: 0x0200, MAP_READ: 0x01 };
  global.GPUMapMode = { READ: 0x01 };
});

/**
 * Fake device whose buffer maps are resolved by hand, so a readback can be left
 * deliberately hung — the failure that froze the real timer on a 3.5M-splat scene.
 */
function makeDevice({ timestamps = true } = {}) {
  const buffers = [];
  return {
    features: { has: (f) => timestamps && f === 'timestamp-query' },
    createQuerySet: () => ({ destroy: jest.fn() }),
    createBuffer: ({ size }) => {
      const buf = {
        size,
        ticks: new BigUint64Array(size / 8),
        _resolve: null,
        mapAsync: jest.fn(function () { return new Promise((res) => { buf._resolve = res; }); }),
        getMappedRange: () => buf.ticks.buffer.slice(0),
        unmap: jest.fn(),
        destroy: jest.fn(),
        /** Complete the pending map with the given per-span [begin, end] pairs. */
        settle(pairs) {
          pairs.forEach(([b, e], i) => { buf.ticks[i * 2] = BigInt(b); buf.ticks[i * 2 + 1] = BigInt(e); });
          const r = buf._resolve;
          buf._resolve = null;
          r?.();
          return Promise.resolve().then(() => {}).then(() => {});
        },
        get mapped() { return buf._resolve !== null; },
      };
      buffers.push(buf);
      return buf;
    },
    buffers,
  };
}

const encoder = () => ({ resolveQuerySet: jest.fn(), copyBufferToBuffer: jest.fn() });

/** Buffers created for readback slots (index 0 is the resolve buffer). */
const slotBuffers = (device) => device.buffers.slice(1);

/** Run one frame: begin, assign spans, resolve, readback. */
function frame(timer, names) {
  timer.beginFrame();
  const writes = names.map((n) => timer.span(n));
  const enc = encoder();
  timer.resolve(enc);
  timer.readback();
  return { writes, enc };
}

describe('GpuTimer — feature gating', () => {
  test('every span is null and no buffers are made without timestamp-query', () => {
    const device = makeDevice({ timestamps: false });
    const timer = new GpuTimer(device, 4, () => 0);
    timer.beginFrame();
    expect(timer.span('sort')).toBeNull();
    expect(device.buffers).toHaveLength(0);
    expect(timer.getDurations()).toEqual({});
  });
});

describe('GpuTimer — span assignment', () => {
  test('spans get consecutive query pairs and stop at maxSpans', () => {
    const timer = new GpuTimer(makeDevice(), 2, () => 0);
    timer.beginFrame();
    expect(timer.span('a')).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(timer.span('b')).toMatchObject({ beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 });
    expect(timer.span('c')).toBeNull(); // budget spent
  });
});

describe('GpuTimer — readings', () => {
  test('a completed readback reports durations in ms', async () => {
    const device = makeDevice();
    const timer = new GpuTimer(device, 4, () => 1000);
    frame(timer, ['sort', 'render']);
    await slotBuffers(device)[0].settle([[0, 2_000_000], [0, 5_000_000]]);
    expect(timer.getDurations()).toEqual({ sort: 2, render: 5 });
  });

  test('names travel with the slot, so timings cannot be misattributed', async () => {
    // Frame 1 measures [sort, render]; frame 2 measures only [render]. If names
    // were read from the *current* frame, frame 1's readback would land on the
    // wrong keys.
    const device = makeDevice();
    const timer = new GpuTimer(device, 4, () => 1000);
    frame(timer, ['sort', 'render']);
    frame(timer, ['render']);
    await slotBuffers(device)[0].settle([[0, 7_000_000], [0, 9_000_000]]);
    const d = timer.getDurations();
    expect(d.sort).toBe(7);
    expect(d.render).toBe(9);
  });
});

describe('GpuTimer — a hung readback must not freeze the instrument', () => {
  test('frames keep resolving into other slots while one map is stuck', async () => {
    const device = makeDevice();
    const timer = new GpuTimer(device, 4, () => 1000);
    const slots = slotBuffers(device);

    const f1 = frame(timer, ['sort']);        // slot 0 — never settled
    expect(f1.enc.copyBufferToBuffer).toHaveBeenCalled();
    const f2 = frame(timer, ['sort']);        // slot 1
    expect(f2.enc.copyBufferToBuffer).toHaveBeenCalled();

    // Slot 1 completes even though slot 0 is still wedged.
    await slots[1].settle([[0, 3_000_000]]);
    expect(timer.getDurations()).toEqual({ sort: 3 });
    expect(slots[0].mapped).toBe(true); // still hung, by construction
  });

  test('with every slot wedged, frames are skipped rather than stalled or faked', async () => {
    const device = makeDevice();
    const timer = new GpuTimer(device, 4, () => 1000);
    for (let i = 0; i < 3; i++) frame(timer, ['sort']); // consume all slots

    const starved = frame(timer, ['sort']);
    expect(starved.enc.copyBufferToBuffer).not.toHaveBeenCalled();
    expect(timer.skippedFrames).toBe(1);
    // Crucially it does not throw, and recovers once a slot frees up.
    await slotBuffers(device)[0].settle([[0, 4_000_000]]);
    const recovered = frame(timer, ['sort']);
    expect(recovered.enc.copyBufferToBuffer).toHaveBeenCalled();
  });
});

describe('GpuTimer — staleness', () => {
  test('the window widens with the frame interval so slow scenes still report', async () => {
    // A 3.5M-splat scene runs ~1.5s/frame; a flat 2s window would withhold every
    // reading it ever produced.
    const device = makeDevice();
    let clock = 0;
    const timer = new GpuTimer(device, 4, () => clock);
    for (let i = 0; i < 12; i++) { clock += 1500; timer.beginFrame(); }
    timer.beginFrame();
    timer.span('sort');
    timer.resolve(encoder());
    timer.readback();
    await slotBuffers(device)[0].settle([[0, 1_000_000_000]]);
    expect(timer.getDurations()).toEqual({ sort: 1000 });
    clock += 4000; // under 4 x 1500ms of slack
    expect(timer.getDurations()).toEqual({ sort: 1000 });
    clock += 3000; // now well past it
    expect(timer.getDurations()).toEqual({});
  });

  test('a reading older than the stale window is withheld, not served as current', async () => {
    const device = makeDevice();
    let clock = 1000;
    const timer = new GpuTimer(device, 4, () => clock);
    frame(timer, ['sort']);
    await slotBuffers(device)[0].settle([[0, 6_000_000]]);
    expect(timer.getDurations()).toEqual({ sort: 6 });

    clock += 1999;
    expect(timer.getDurations()).toEqual({ sort: 6 }); // still fresh

    clock += 2;
    // The bug this replaces: the old timer kept returning this number forever,
    // so a frozen readback looked like a live measurement.
    expect(timer.getDurations()).toEqual({});
  });
});
