/**
 * @file Provides matrix utility functions for 3D transformations.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

export function createIdentityMatrix() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function createPerspectiveMatrix(fieldOfView, aspect, zNear, zFar) {
    const f = 1.0 / Math.tan(fieldOfView / 2);
    const rangeInv = 1 / (zNear - zFar);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (zNear + zFar) * rangeInv, -1,
        0, 0, zNear * zFar * rangeInv * 2, 0
    ]);
}

export function translateMatrix(matrix, vector) {
    const x = vector[0], y = vector[1], z = vector[2];
    matrix[12] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    matrix[13] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    matrix[14] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    matrix[15] = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
}

export function rotateMatrix(matrix, angle, axis) {
    let x = axis[0], y = axis[1], z = axis[2];
    let len = Math.hypot(x, y, z);
    if (len < 0.00001) { return; }
    len = 1 / len;
    x *= len; y *= len; z *= len;

    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const t = 1 - c;

    const a00 = matrix[0], a01 = matrix[1], a02 = matrix[2], a03 = matrix[3];
    const a10 = matrix[4], a11 = matrix[5], a12 = matrix[6], a13 = matrix[7];
    const a20 = matrix[8], a21 = matrix[9], a22 = matrix[10], a23 = matrix[11];

    const b00 = x * x * t + c,     b01 = y * x * t + z * s, b02 = z * x * t - y * s;
    const b10 = x * y * t - z * s, b11 = y * y * t + c,     b12 = z * y * t + x * s;
    const b20 = x * z * t + y * s, b21 = y * z * t - x * s, b22 = z * z * t + c;

    matrix[0] = a00 * b00 + a10 * b01 + a20 * b02;
    matrix[1] = a01 * b00 + a11 * b01 + a21 * b02;
    matrix[2] = a02 * b00 + a12 * b01 + a22 * b02;
    matrix[3] = a03 * b00 + a13 * b01 + a23 * b02;
    matrix[4] = a00 * b10 + a10 * b11 + a20 * b12;
    matrix[5] = a01 * b10 + a11 * b11 + a21 * b12;
    matrix[6] = a02 * b10 + a12 * b11 + a22 * b12;
    matrix[7] = a03 * b10 + a13 * b11 + a23 * b12;

    matrix[8] = a00 * b20 + a10 * b21 + a20 * b22;
    matrix[9] = a01 * b20 + a11 * b21 + a21 * b22;
    matrix[10] = a02 * b20 + a12 * b21 + a22 * b22;
    matrix[11] = a03 * b20 + a13 * b21 + a23 * b22;
}