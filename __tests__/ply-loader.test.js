import { parsePly, sigmoid, SH_C0 } from '../scripts/engine/ply-loader.js';

// Standard 3DGS vertex properties used by the synthetic fixture (all float32).
const PROPS = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

/**
 * Builds a binary_little_endian PLY ArrayBuffer from an array of vertex objects
 * (keyed by the PROPS names above).
 */
function buildPly(vertices, { format = 'binary_little_endian' } = {}) {
  const header =
    'ply\n' +
    `format ${format} 1.0\n` +
    `element vertex ${vertices.length}\n` +
    PROPS.map((p) => `property float ${p}`).join('\n') + '\n' +
    'end_header\n';

  const headerBytes = new TextEncoder().encode(header);
  const stride = PROPS.length * 4;
  const body = new ArrayBuffer(vertices.length * stride);
  const dv = new DataView(body);
  vertices.forEach((v, i) => {
    PROPS.forEach((p, j) => {
      dv.setFloat32(i * stride + j * 4, v[p] ?? 0, true);
    });
  });

  const out = new Uint8Array(headerBytes.length + body.byteLength);
  out.set(headerBytes, 0);
  out.set(new Uint8Array(body), headerBytes.length);
  return out.buffer;
}

describe('parsePly', () => {
  const v0 = {
    x: 1, y: 2, z: 3,
    f_dc_0: 1.0, f_dc_1: 0.0, f_dc_2: -1.0,
    opacity: 0.0,            // sigmoid(0) = 0.5
    scale_0: 0, scale_1: 1, scale_2: -1, // exp -> 1, e, 1/e
    rot_0: 1, rot_1: 1, rot_2: 0, rot_3: 0, // normalize -> (√½, √½, 0, 0)
  };
  const v1 = {
    x: -1, y: -2, z: -3,
    f_dc_0: 0, f_dc_1: 0, f_dc_2: 0,
    opacity: 2.0,
    scale_0: 0, scale_1: 0, scale_2: 0,
    rot_0: 0, rot_1: 0, rot_2: 0, rot_3: 2, // normalize -> (0,0,0,1)
  };

  test('parses count, positions, and bounds', () => {
    const result = parsePly(buildPly([v0, v1]));
    expect(result.count).toBe(2);
    expect(Array.from(result.positions)).toEqual([1, 2, 3, -1, -2, -3]);

    // center = midpoint = origin; radius = distance from origin to either point.
    expect(result.bounds.center).toEqual([0, 0, 0]);
    expect(result.bounds.radius).toBeCloseTo(Math.hypot(1, 2, 3), 5);
  });

  test('applies SH degree-0 color, sigmoid opacity, exp scale', () => {
    const { colors, opacities, scales } = parsePly(buildPly([v0, v1]));

    expect(colors[0]).toBeCloseTo(0.5 + SH_C0 * 1.0, 6);
    expect(colors[1]).toBeCloseTo(0.5, 6);
    expect(colors[2]).toBeCloseTo(0.5 + SH_C0 * -1.0, 6);

    expect(opacities[0]).toBeCloseTo(0.5, 6);
    expect(opacities[1]).toBeCloseTo(sigmoid(2.0), 6);

    expect(scales[0]).toBeCloseTo(1, 6);
    expect(scales[1]).toBeCloseTo(Math.E, 5);
    expect(scales[2]).toBeCloseTo(1 / Math.E, 6);
  });

  test('normalizes rotation quaternions', () => {
    const { rotations } = parsePly(buildPly([v0, v1]));
    const inv = 1 / Math.SQRT2;
    expect(rotations[0]).toBeCloseTo(inv, 6);
    expect(rotations[1]).toBeCloseTo(inv, 6);
    expect(rotations[2]).toBeCloseTo(0, 6);
    expect(rotations[3]).toBeCloseTo(0, 6);
    // v1: (0,0,0,2) -> (0,0,0,1)
    expect(rotations[4]).toBeCloseTo(0, 6);
    expect(rotations[7]).toBeCloseTo(1, 6);
  });

  test('handles an empty point cloud', () => {
    const result = parsePly(buildPly([]));
    expect(result.count).toBe(0);
    expect(result.bounds).toBeNull();
    expect(result.positions.length).toBe(0);
  });

  test('rejects ASCII PLY', () => {
    expect(() => parsePly(buildPly([v0], { format: 'ascii' }))).toThrow(/ASCII/);
  });

  test('rejects a buffer without end_header', () => {
    const bytes = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\n');
    expect(() => parsePly(bytes.buffer)).toThrow(/end_header/);
  });

  test('rejects a truncated binary body', () => {
    const full = new Uint8Array(buildPly([v0, v1]));
    // Drop the last few bytes so the body is shorter than declared.
    expect(() => parsePly(full.slice(0, full.length - 8).buffer)).toThrow(/shorter/);
  });
});
