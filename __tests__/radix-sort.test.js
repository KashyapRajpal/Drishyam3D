import {
  RADIX_BUCKETS,
  RADIX_PASSES,
  BLOCK_SIZE,
  FAR_KEY,
  orderableFromFloat,
  floatFromOrderable,
  alignUp,
  digitOf,
  encodeKeys,
  histogram,
  exclusiveScan,
  scatter,
  radixSortIndices,
} from '../scripts/engine/ordering/radix-reference.js';

/** Deterministic LCG — same style as grid.test.js. */
function makeRand(seed = 1) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** Stable expected order: ascending key, ties broken by original index. */
function expectedOrder(paddedKeys) {
  return Array.from({ length: paddedKeys.length }, (_, i) => i)
    .sort((a, b) => (paddedKeys[a] - paddedKeys[b]) || (a - b));
}

/** Pad a key array to a block multiple with FAR_KEY, as compute_keys does on GPU. */
function padKeys(keys, count, blockSize) {
  const padded = new Float32Array(alignUp(count, blockSize)).fill(FAR_KEY);
  padded.set(keys.subarray(0, count));
  return padded;
}

describe('orderableFromFloat — order-preserving f32 → u32', () => {
  // Spans both signs, both zeros, f32 denormals, and the sentinel. Ascending.
  const ASCENDING = [
    -FAR_KEY, -1e10, -1, -1e-10, -1.4e-45, -0, 0, 1.4e-45, 1e-10, 1, 1e10, FAR_KEY,
  ].map(Math.fround);

  test('strictly increasing floats map to strictly increasing u32', () => {
    const ordered = ASCENDING.map(orderableFromFloat);
    for (let i = 0; i < ASCENDING.length; i++) {
      for (let j = i + 1; j < ASCENDING.length; j++) {
        // Only assert where the floats genuinely differ (±0 compare equal).
        if (ASCENDING[i] < ASCENDING[j]) {
          expect(ordered[i]).toBeLessThan(ordered[j]);
        }
      }
    }
  });

  test('negatives all sort below positives', () => {
    expect(orderableFromFloat(-1e-30)).toBeLessThan(orderableFromFloat(1e-30));
    expect(orderableFromFloat(-FAR_KEY)).toBeLessThan(orderableFromFloat(-1e10));
  });

  test('±0 map to adjacent distinct codes, −0 first', () => {
    // They compare equal as floats, so this is a deterministic tie-break, not an
    // ordering error — documented because it is the one place the map is not 1:1
    // with float equality.
    expect(orderableFromFloat(-0)).toBe(0x7fffffff);
    expect(orderableFromFloat(0)).toBe(0x80000000);
  });

  test('round-trips back to the original f32', () => {
    for (const f of ASCENDING) {
      expect(floatFromOrderable(orderableFromFloat(f))).toBe(f);
    }
  });

  test('fuzz: monotonic across 5000 random f32 values', () => {
    const rand = makeRand(7);
    const values = Array.from({ length: 5000 }, () => Math.fround((rand() - 0.5) * 2e6));
    values.sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] < values[i]) {
        expect(orderableFromFloat(values[i - 1])).toBeLessThan(orderableFromFloat(values[i]));
      }
    }
  });

  test('FAR_KEY outranks every plausible depth key', () => {
    const far = orderableFromFloat(FAR_KEY);
    const rand = makeRand(11);
    for (let i = 0; i < 1000; i++) {
      expect(orderableFromFloat((rand() - 0.5) * 2e6)).toBeLessThan(far);
    }
  });
});

describe('encodeKeys', () => {
  test('pads the tail with the FAR_KEY code', () => {
    const keys = Float32Array.from([-3, -1, -2]);
    const out = encodeKeys(keys, 3, 8);
    expect(out.length).toBe(8);
    expect(out[0]).toBe(orderableFromFloat(-3));
    for (let i = 3; i < 8; i++) expect(out[i]).toBe(orderableFromFloat(FAR_KEY));
  });
});

describe('digitOf', () => {
  test('extracts the byte examined by each pass', () => {
    const key = 0xdeadbeef;
    expect(digitOf(key, 0)).toBe(0xef);
    expect(digitOf(key, 1)).toBe(0xbe);
    expect(digitOf(key, 2)).toBe(0xad);
    expect(digitOf(key, 3)).toBe(0xde);
  });

  test('four passes cover the full 32-bit key', () => {
    expect(RADIX_PASSES).toBe(4);
    expect(RADIX_BUCKETS).toBe(256);
  });
});

describe('histogram + exclusiveScan — digit-major offsets', () => {
  // Hand-verified fixture: 8 keys, blockSize 4 ⇒ 2 blocks, digits = key values.
  //   block0 = [0,1,0,2]   block1 = [1,1,3,0]
  //   digit0 → 2 in b0, 1 in b1   digit1 → 1 in b0, 2 in b1
  //   digit2 → 1 in b0, 0 in b1   digit3 → 0 in b0, 1 in b1
  const KEYS = Uint32Array.from([0, 1, 0, 2, 1, 1, 3, 0]);
  const BLOCK = 4;
  const BLOCKS = 2;

  test('counts land in digit-major slots', () => {
    const hist = histogram(KEYS, 0, BLOCK);
    expect(hist.length).toBe(RADIX_BUCKETS * BLOCKS);
    expect(hist[0 * BLOCKS + 0]).toBe(2);
    expect(hist[0 * BLOCKS + 1]).toBe(1);
    expect(hist[1 * BLOCKS + 0]).toBe(1);
    expect(hist[1 * BLOCKS + 1]).toBe(2);
    expect(hist[2 * BLOCKS + 0]).toBe(1);
    expect(hist[2 * BLOCKS + 1]).toBe(0);
    expect(hist[3 * BLOCKS + 0]).toBe(0);
    expect(hist[3 * BLOCKS + 1]).toBe(1);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(KEYS.length);
  });

  test('one scan yields each (digit, block) its global base', () => {
    const base = exclusiveScan(histogram(KEYS, 0, BLOCK));
    // digit0 occupies [0,3), digit1 [3,6), digit2 [6,7), digit3 [7,8).
    expect(base[0 * BLOCKS + 0]).toBe(0);
    expect(base[0 * BLOCKS + 1]).toBe(2);
    expect(base[1 * BLOCKS + 0]).toBe(3);
    expect(base[1 * BLOCKS + 1]).toBe(4);
    expect(base[2 * BLOCKS + 0]).toBe(6);
    expect(base[3 * BLOCKS + 1]).toBe(7);
  });

  test('scatter places every element at base + in-block rank', () => {
    const base = exclusiveScan(histogram(KEYS, 0, BLOCK));
    const idxIn = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const keysOut = new Uint32Array(8);
    const idxOut = new Uint32Array(8);
    scatter(KEYS, idxIn, keysOut, idxOut, base, 0, BLOCK);
    expect(Array.from(keysOut)).toEqual([0, 0, 0, 1, 1, 1, 2, 3]);
    // Stable: within each digit, original indices stay ascending.
    expect(Array.from(idxOut)).toEqual([0, 2, 7, 1, 4, 5, 3, 6]);
  });

  test('exclusiveScan is a running sum starting at zero', () => {
    expect(Array.from(exclusiveScan(Uint32Array.from([3, 0, 5, 1])))).toEqual([0, 3, 3, 8]);
  });
});

describe('radixSortIndices — full sort', () => {
  /** Sort `keys` and assert the result matches a stable ascending reference. */
  function checkSort(keys, count, blockSize) {
    const padded = padKeys(keys, count, blockSize);
    const { indices, padded: n } = radixSortIndices(keys, count, { blockSize });
    expect(n).toBe(padded.length);
    expect(Array.from(indices)).toEqual(expectedOrder(padded));
    return { indices, padded };
  }

  test('random mixed-sign keys, multi-block', () => {
    const rand = makeRand(3);
    const count = 500;
    const keys = Float32Array.from({ length: count }, () => (rand() - 0.5) * 2000);
    checkSort(keys, count, 16);
  });

  test('all-negative keys (the common case — view z is negative in front)', () => {
    const rand = makeRand(5);
    const count = 300;
    const keys = Float32Array.from({ length: count }, () => -rand() * 1000 - 0.001);
    checkSort(keys, count, 16);
  });

  test('all-equal keys preserve input order (stability)', () => {
    const count = 100;
    const keys = new Float32Array(count).fill(-42.5);
    const { indices } = radixSortIndices(keys, count, { blockSize: 16 });
    expect(Array.from(indices.subarray(0, count))).toEqual(
      Array.from({ length: count }, (_, i) => i),
    );
  });

  test('duplicate keys keep ascending index order within each tie group', () => {
    // Four distinct depths, 25 splats each, interleaved.
    const count = 100;
    const keys = Float32Array.from({ length: count }, (_, i) => -(i % 4) - 1);
    const { indices } = radixSortIndices(keys, count, { blockSize: 16 });
    for (let i = 1; i < count; i++) {
      const a = indices[i - 1];
      const b = indices[i];
      if (keys[a] === keys[b]) expect(a).toBeLessThan(b);
    }
  });

  test('count that is not a block multiple pads and sinks the tail', () => {
    const rand = makeRand(9);
    const count = 70; // blockSize 16 ⇒ padded 80
    const keys = Float32Array.from({ length: count }, () => -rand() * 500);
    const { indices, padded } = checkSort(keys, count, 16);
    expect(padded.length).toBe(80);
    // Every padding entry must land past every real splat.
    const firstPadPos = Array.from(indices).findIndex((i) => i >= count);
    expect(firstPadPos).toBe(count);
  });

  test('culled splats (FAR_KEY, as apply_cull writes) sort past the visible set', () => {
    const count = 64;
    const keys = Float32Array.from({ length: count }, (_, i) => (i % 2 === 0 ? -i - 1 : FAR_KEY));
    // FAR_KEY is an f64 literal; storing it in a Float32Array rounds it, so the
    // sentinel must be compared in f32 space. (Moot in WGSL, where it is f32
    // throughout — but a live trap for any JS-side readback.)
    const farF32 = Math.fround(FAR_KEY);
    const { indices } = radixSortIndices(keys, count, { blockSize: 16 });
    const visible = count / 2;
    for (let i = 0; i < visible; i++) expect(keys[indices[i]]).not.toBe(farF32);
    for (let i = visible; i < count; i++) expect(keys[indices[i]]).toBe(farF32);
  });

  test('output is a permutation of the padded index range', () => {
    const rand = makeRand(13);
    const count = 257;
    const keys = Float32Array.from({ length: count }, () => (rand() - 0.5) * 1e4);
    const { indices, padded } = radixSortIndices(keys, count, { blockSize: 32 });
    const seen = new Uint8Array(padded);
    for (const v of indices) {
      expect(v).toBeLessThan(padded);
      expect(seen[v]).toBe(0);
      seen[v] = 1;
    }
  });

  test('sorts at the production block size', () => {
    const rand = makeRand(17);
    const count = 5000; // BLOCK_SIZE 4096 ⇒ padded 8192, 2 blocks
    const keys = Float32Array.from({ length: count }, () => -rand() * 1e4);
    const padded = padKeys(keys, count, BLOCK_SIZE);
    const { indices, padded: n } = radixSortIndices(keys, count);
    expect(n).toBe(8192);
    expect(Array.from(indices)).toEqual(expectedOrder(padded));
  });

  test('ping-pong parity: an even pass count returns the result in buffer A', () => {
    // Guards the GPU invariant that the render bind group, bound once to buffer A
    // in prepare(), still points at the sorted indices after run().
    expect(RADIX_PASSES % 2).toBe(0);
  });
});
