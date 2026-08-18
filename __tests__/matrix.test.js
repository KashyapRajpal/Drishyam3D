import { composeTRSMatrix, createIdentityMatrix, multiplyMatrices, createPerspectiveMatrix, translateMatrix, rotateMatrix, createLookAtMatrix, invertMatrix, transformPoint, transformDirection } from '../scripts/engine/matrix.js';

describe('Matrix Functions', () => {
  test('createIdentityMatrix should return an identity matrix', () => {
    const matrix = createIdentityMatrix();
    const expected = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(matrix).toEqual(expected);
  });

  test('multiplyMatrices should correctly multiply two matrices', () => {
    const m1 = new Float32Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ]);
    const m2 = createIdentityMatrix();
    const result = multiplyMatrices(m1, m2);
    expect(result).toEqual(m1);
  });

  test('createPerspectiveMatrix should create a valid perspective matrix', () => {
    const fov = Math.PI / 4;
    const aspect = 16 / 9;
    const zNear = 1;
    const zFar = 100;
    const matrix = createPerspectiveMatrix(fov, aspect, zNear, zFar);
    const f = 1.0 / Math.tan(fov / 2);
    const rangeInv = 1 / (zNear - zFar);
    const expected = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (zNear + zFar) * rangeInv, -1,
      0, 0, zNear * zFar * rangeInv * 2, 0
    ]);
    expect(matrix).toEqual(expected);
  });

  test('translateMatrix should correctly translate a matrix', () => {
    const matrix = createIdentityMatrix();
    const vector = [2, 3, 4];
    translateMatrix(matrix, vector);
    const expected = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 4, 1,
    ]);
    expect(matrix).toEqual(expected);
  });

  test('rotateMatrix should correctly rotate a matrix', () => {
    const matrix = createIdentityMatrix();
    const angle = Math.PI / 2;
    const axis = [0, 1, 0];
    rotateMatrix(matrix, angle, axis);
    const expected = new Float32Array([
      Math.cos(angle), 0, -Math.sin(angle), 0,
      0, 1, 0, 0,
      Math.sin(angle), 0, Math.cos(angle), 0,
      0, 0, 0, 1,
    ]);
    // Use toBeCloseTo for floating point comparisons
    for (let i = 0; i < expected.length; i++) {
      expect(matrix[i]).toBeCloseTo(expected[i]);
    }
  });

  test('createLookAtMatrix should create a valid look-at matrix', () => {
    const eye = [0, 0, 5];
    const target = [0, 0, 0];
    const up = [0, 1, 0];
    const matrix = createLookAtMatrix(eye, target, up);
    const expected = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -5, 1,
    ]);
    for (let i = 0; i < expected.length; i++) {
      expect(matrix[i]).toBeCloseTo(expected[i]);
    }
  });

  test('invertMatrix returns a multiplicative inverse', () => {
    const matrix = createIdentityMatrix();
    translateMatrix(matrix, [2, -3, 4]);
    rotateMatrix(matrix, 0.37, [0, 1, 0]);
    const inverse = invertMatrix(matrix);
    const product = multiplyMatrices(matrix, inverse);
    const identity = createIdentityMatrix();
    for (let i = 0; i < 16; i += 1) expect(product[i]).toBeCloseTo(identity[i], 5);
  });

  test('invertMatrix rejects singular matrices', () => {
    expect(() => invertMatrix(new Float32Array(16))).toThrow(/singular/i);
  });

  test('point and direction transforms distinguish translation', () => {
    const matrix = createIdentityMatrix();
    translateMatrix(matrix, [2, 3, 4]);
    expect(transformPoint(matrix, [1, 1, 1])).toEqual([3, 4, 5]);
    expect(transformDirection(matrix, [1, 1, 1])).toEqual([1, 1, 1]);
  });

  test('composeTRSMatrix follows glTF T * R * S order', () => {
    const matrix = composeTRSMatrix(
      [10, 0, 0],
      [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      [2, 3, 4],
    );
    const point = transformPoint(matrix, [1, 1, 1]);
    expect(point[0]).toBeCloseTo(7);
    expect(point[1]).toBeCloseTo(2);
    expect(point[2]).toBeCloseTo(4);
  });
});
