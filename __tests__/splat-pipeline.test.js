import { createSplatPipeline, payloadTransferables } from '../scripts/engine/splat-pipeline.js';
import { parsePly, mirrorYInPlace } from '../scripts/engine/ply-loader.js';
import { packSplats } from '../scripts/engine/splat-helpers.js';

const PROPS = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

/** Builds a binary_little_endian PLY ArrayBuffer from vertex objects. */
function buildPly(vertices, props = PROPS) {
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    `element vertex ${vertices.length}\n` +
    props.map((p) => `property float ${p}`).join('\n') + '\n' +
    'end_header\n';
  const headerBytes = new TextEncoder().encode(header);
  const stride = props.length * 4;
  const body = new ArrayBuffer(vertices.length * stride);
  const dv = new DataView(body);
  vertices.forEach((v, i) => {
    props.forEach((p, j) => dv.setFloat32(i * stride + j * 4, v[p] ?? 0, true));
  });
  const out = new Uint8Array(headerBytes.length + body.byteLength);
  out.set(headerBytes, 0);
  out.set(new Uint8Array(body), headerBytes.length);
  return out.buffer;
}

const V0 = {
  x: 1, y: 2, z: 3,
  f_dc_0: 1, f_dc_1: 0, f_dc_2: -1,
  opacity: 0,
  scale_0: 0, scale_1: 1, scale_2: -1,
  rot_0: 1, rot_1: 1, rot_2: 0, rot_3: 0,
};
const V1 = {
  x: -1, y: -2, z: -3,
  f_dc_0: 0, f_dc_1: 0, f_dc_2: 0,
  opacity: 2,
  scale_0: 0, scale_1: 0, scale_2: 0,
  rot_0: 0, rot_1: 0, rot_2: 0, rot_3: 2,
};

describe('createSplatPipeline', () => {
  test('load without flip matches direct parse + pack', () => {
    const buf = buildPly([V0, V1]);
    const payload = createSplatPipeline().load(buf, false);

    const parsed = parsePly(buildPly([V0, V1]));
    expect(payload.count).toBe(2);
    expect(payload.shDegree).toBe(parsed.shDegree);
    expect(payload.bounds).toEqual(parsed.bounds);
    expect(Array.from(payload.positions)).toEqual(Array.from(parsed.positions));
    expect(Array.from(payload.packed)).toEqual(Array.from(packSplats(parsed)));
  });

  test('load with flipY matches parse + mirror + pack', () => {
    const payload = createSplatPipeline().load(buildPly([V0, V1]), true);

    const mirrored = mirrorYInPlace(parsePly(buildPly([V0, V1])));
    expect(Array.from(payload.positions)).toEqual(Array.from(mirrored.positions));
    expect(Array.from(payload.packed)).toEqual(Array.from(packSplats(mirrored)));
  });

  test('setFlip toggles between flipped and unflipped packs', () => {
    const pipeline = createSplatPipeline();
    const unflipped = pipeline.load(buildPly([V0, V1]), false);

    const flipped = pipeline.setFlip(true);
    const mirrored = mirrorYInPlace(parsePly(buildPly([V0, V1])));
    expect(Array.from(flipped.packed)).toEqual(Array.from(packSplats(mirrored)));

    // Toggling back reproduces the original unflipped pack (mirror is its own inverse).
    const back = pipeline.setFlip(false);
    expect(Array.from(back.packed)).toEqual(Array.from(unflipped.packed));
  });

  test('setFlip returns null when the flip state is unchanged', () => {
    const pipeline = createSplatPipeline();
    pipeline.load(buildPly([V0]), true);
    expect(pipeline.setFlip(true)).toBeNull();
  });

  test('setFlip returns null before any load', () => {
    expect(createSplatPipeline().setFlip(true)).toBeNull();
  });

  test('payload arrays are copies, not views into shared state', () => {
    const pipeline = createSplatPipeline();
    const a = pipeline.load(buildPly([V0, V1]), false);
    const b = pipeline.load(buildPly([V0, V1]), false);
    // Distinct backing buffers so transferring one payload cannot detach another.
    expect(a.packed.buffer).not.toBe(b.packed.buffer);
    expect(a.positions.buffer).not.toBe(b.positions.buffer);
  });
});

describe('payloadTransferables', () => {
  test('lists packed + positions buffers, and shCoeffs when present', () => {
    const propsWithRest = PROPS.concat(
      Array.from({ length: 9 }, (_, i) => `f_rest_${i}`),
    );
    const vertex = { ...V0 };
    propsWithRest.forEach((p) => { if (!(p in vertex)) vertex[p] = 0.1; });

    const withSh = createSplatPipeline().load(buildPly([vertex], propsWithRest), false);
    expect(withSh.shCoeffs).not.toBeNull();
    expect(payloadTransferables(withSh)).toEqual([
      withSh.packed.buffer, withSh.positions.buffer, withSh.shCoeffs.buffer,
    ]);

    const noSh = createSplatPipeline().load(buildPly([V0]), false);
    expect(noSh.shCoeffs).toBeNull();
    expect(payloadTransferables(noSh)).toEqual([noSh.packed.buffer, noSh.positions.buffer]);
  });

  test('returns empty for a null payload', () => {
    expect(payloadTransferables(null)).toEqual([]);
  });
});
