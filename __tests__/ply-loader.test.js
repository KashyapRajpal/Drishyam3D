import {
  parsePly, sigmoid, SH_C0, SH_REST_FLIP_Y, shDegreeFromRestCount,
} from '../scripts/engine/ply-loader.js';

// Standard 3DGS vertex properties used by the synthetic fixture (all float32).
const BASE_PROPS = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

/** `restCount` f_rest_* property names, or none. */
function propsWithRest(restCount) {
  return BASE_PROPS.concat(
    Array.from({ length: restCount }, (_, i) => `f_rest_${i}`),
  );
}

const PROPS = BASE_PROPS;

/**
 * Builds a binary_little_endian PLY ArrayBuffer from an array of vertex objects
 * (keyed by the property names above).
 */
function buildPly(vertices, { format = 'binary_little_endian', props = BASE_PROPS } = {}) {
  const header =
    'ply\n' +
    `format ${format} 1.0\n` +
    `element vertex ${vertices.length}\n` +
    props.map((p) => `property float ${p}`).join('\n') + '\n' +
    'end_header\n';

  const headerBytes = new TextEncoder().encode(header);
  const stride = props.length * 4;
  const body = new ArrayBuffer(vertices.length * stride);
  const dv = new DataView(body);
  vertices.forEach((v, i) => {
    props.forEach((p, j) => {
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

  test('parses count, positions, and bounds (with Y-flip)', () => {
    const result = parsePly(buildPly([v0, v1]));
    expect(result.count).toBe(2);
    // Y-coordinates are flipped: y -> -y
    expect(Array.from(result.positions)).toEqual([1, -2, 3, -1, 2, -3]);

    // center = midpoint = origin (after Y-flip); radius = distance from origin to either point.
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

  test('reports degree 0 and no SH data when f_rest_* is absent', () => {
    const result = parsePly(buildPly([v0, v1]));
    expect(result.shDegree).toBe(0);
    expect(result.shCoeffs).toBeNull();
  });
});

describe('shDegreeFromRestCount', () => {
  test('maps per-channel coefficient counts to the highest fully-covered degree', () => {
    expect(shDegreeFromRestCount(0)).toBe(0);
    expect(shDegreeFromRestCount(2)).toBe(0);  // partial degree 1 is unusable
    expect(shDegreeFromRestCount(3)).toBe(1);
    expect(shDegreeFromRestCount(7)).toBe(1);  // partial degree 2
    expect(shDegreeFromRestCount(8)).toBe(2);
    expect(shDegreeFromRestCount(14)).toBe(2); // partial degree 3
    expect(shDegreeFromRestCount(15)).toBe(3);
  });
});

describe('parsePly spherical harmonics', () => {
  /**
   * Builds one vertex whose f_rest_* values encode their own PLY index, so a
   * mis-ordered read is immediately visible in the assertion.
   */
  function vertexWithRest(restCount) {
    const v = { x: 0, y: 0, z: 0, rot_0: 1 };
    for (let i = 0; i < restCount; i++) v[`f_rest_${i}`] = i + 1;
    return v;
  }

  test('detects degree 3 from 45 f_rest properties', () => {
    const props = propsWithRest(45);
    const { shDegree, shCoeffs } = parsePly(buildPly([vertexWithRest(45)], { props }));
    expect(shDegree).toBe(3);
    expect(shCoeffs).toHaveLength(15 * 3);
  });

  test('re-interleaves channel-major file data into coefficient-major rgb triples', () => {
    // Degree 1: 9 rest props, channel-major => R=[1,2,3], G=[4,5,6], B=[7,8,9].
    const props = propsWithRest(9);
    const { shDegree, shCoeffs } = parsePly(buildPly([vertexWithRest(9)], { props }));
    expect(shDegree).toBe(1);

    // Coefficient 0 is odd in y, so its rgb triple is negated by the Y-flip fix;
    // coefficients 1 and 2 are even and pass through unchanged.
    expect(Array.from(shCoeffs)).toEqual([
      -1, -4, -7, // coeff 0 = (R0,G0,B0) negated
       2,  5,  8, // coeff 1 = (R1,G1,B1)
       3,  6,  9, // coeff 2 = (R2,G2,B2)
    ]);
  });

  test('negates exactly the SH basis functions that are odd in y', () => {
    const props = propsWithRest(45);
    const { shCoeffs } = parsePly(buildPly([vertexWithRest(45)], { props }));

    for (let k = 0; k < 15; k++) {
      // Red channel of coefficient k is f_rest_k, whose stored value is k+1.
      const expected = SH_REST_FLIP_Y.has(k) ? -(k + 1) : (k + 1);
      expect(shCoeffs[k * 3]).toBeCloseTo(expected, 6);
    }
    // Guard the exact flip set, since a wrong one silently mis-shades the scene.
    expect([...SH_REST_FLIP_Y].sort((a, b) => a - b)).toEqual([0, 3, 4, 8, 9, 10]);
  });

  test('keeps only the highest fully-covered degree when extra coefficients exist', () => {
    // 30 rest props => 10 per channel => degree 2 (8 per channel) is the most we can use.
    const props = propsWithRest(30);
    const { shDegree, shCoeffs } = parsePly(buildPly([vertexWithRest(30)], { props }));
    expect(shDegree).toBe(2);
    expect(shCoeffs).toHaveLength(8 * 3);
    // Green channel of coefficient 0 is f_rest_10 (= 11), negated as an odd-in-y term.
    expect(shCoeffs[1]).toBeCloseTo(-11, 6);
  });

  test('keeps per-splat SH blocks independent', () => {
    const props = propsWithRest(9);
    const a = vertexWithRest(9);
    const b = { x: 0, y: 0, z: 0, rot_0: 1 };
    for (let i = 0; i < 9; i++) b[`f_rest_${i}`] = (i + 1) * 10;

    const { shCoeffs } = parsePly(buildPly([a, b], { props }));
    expect(shCoeffs).toHaveLength(2 * 9);
    expect(shCoeffs[0]).toBeCloseTo(-1, 6);   // splat 0, coeff 0, red
    expect(shCoeffs[9]).toBeCloseTo(-10, 6);  // splat 1, coeff 0, red
  });
});
