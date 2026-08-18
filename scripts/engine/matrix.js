/**
 * @file Provides matrix utility functions for 3D transformations.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

export function createIdentityMatrix() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

/**
 * Composes a glTF node transform as T * R * S.
 * Quaternions use glTF's [x, y, z, w] order.
 */
export function composeTRSMatrix(
    translation = [0, 0, 0],
    rotation = [0, 0, 0, 1],
    scale = [1, 1, 1],
) {
    if (translation.length !== 3 || rotation.length !== 4 || scale.length !== 3) {
        throw new Error('TRS requires translation[3], rotation[4], and scale[3].');
    }
    const values = [...translation, ...rotation, ...scale];
    if (!values.every(Number.isFinite)) throw new Error('TRS values must be finite.');

    let [x, y, z, w] = rotation;
    const quaternionLength = Math.hypot(x, y, z, w);
    if (quaternionLength < 1e-12) throw new Error('TRS rotation quaternion must not be zero length.');
    x /= quaternionLength;
    y /= quaternionLength;
    z /= quaternionLength;
    w /= quaternionLength;

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const [sx, sy, sz] = scale;

    return new Float32Array([
        (1 - yy - zz) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - xx - zz) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - xx - yy) * sz, 0,
        translation[0], translation[1], translation[2], 1,
    ]);
}

/**
 * Returns the inverse of a column-major 4x4 matrix.
 * @param {ArrayLike<number>} matrix
 * @returns {Float32Array}
 * @throws {Error} when the matrix is singular or contains non-finite values.
 */
export function invertMatrix(matrix) {
    if (!matrix || matrix.length !== 16) {
        throw new Error('invertMatrix expects a 4x4 matrix (16 values).');
    }
    for (let i = 0; i < 16; i += 1) {
        if (!Number.isFinite(matrix[i])) {
            throw new Error('Cannot invert a matrix containing non-finite values.');
        }
    }

    const a00 = matrix[0], a01 = matrix[1], a02 = matrix[2], a03 = matrix[3];
    const a10 = matrix[4], a11 = matrix[5], a12 = matrix[6], a13 = matrix[7];
    const a20 = matrix[8], a21 = matrix[9], a22 = matrix[10], a23 = matrix[11];
    const a30 = matrix[12], a31 = matrix[13], a32 = matrix[14], a33 = matrix[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    const determinant = b00 * b11 - b01 * b10 + b02 * b09
        + b03 * b08 - b04 * b07 + b05 * b06;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
        throw new Error('Cannot invert a singular matrix.');
    }
    const invDet = 1 / determinant;
    const out = new Float32Array(16);
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * invDet;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * invDet;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * invDet;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * invDet;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * invDet;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
    return out;
}

/** Transform a point by a column-major 4x4 matrix, including perspective divide. */
export function transformPoint(matrix, point) {
    const x = point[0], y = point[1], z = point[2];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const invW = w !== 0 ? 1 / w : 1;
    return [
        (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * invW,
        (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * invW,
        (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * invW,
    ];
}

/** Transform a direction by the upper-left 3x3 of a column-major 4x4 matrix. */
export function transformDirection(matrix, direction) {
    const x = direction[0], y = direction[1], z = direction[2];
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z,
        matrix[1] * x + matrix[5] * y + matrix[9] * z,
        matrix[2] * x + matrix[6] * y + matrix[10] * z,
    ];
}

/** Determinant of the upper-left 3x3 linear transform. */
export function determinant3x3(matrix) {
    return matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
        - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
        + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
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


export function createLookAtMatrix(eye, target, up) {
    let z0 = eye[0] - target[0], z1 = eye[1] - target[1], z2 = eye[2] - target[2];
    let len = 1 / Math.hypot(z0, z1, z2);
    z0 *= len; z1 *= len; z2 *= len;

    let x0 = up[1] * z2 - up[2] * z1,
        x1 = up[2] * z0 - up[0] * z2,
        x2 = up[0] * z1 - up[1] * z0;
    len = 1 / Math.hypot(x0, x1, x2);
    x0 *= len; x1 *= len; x2 *= len;

    let y0 = z1 * x2 - z2 * x1,
        y1 = z2 * x0 - z0 * x2,
        y2 = z0 * x1 - z1 * x0;

    return new Float32Array([
        x0, y0, z0, 0,
        x1, y1, z1, 0,
        x2, y2, z2, 0,
        -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
        -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
        -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]),
        1
    ]);
}

export function multiplyMatrices(a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    let b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    const out = new Float32Array(16);
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    return out;
}
