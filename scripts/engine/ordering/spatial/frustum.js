/**
 * @file Frustum planes from a view-projection matrix + AABB test.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Pure (no GPU): extracts the six world-space frustum planes from a column-major
 * view-projection matrix (Gribb–Hartmann) and tests an AABB against them. The
 * Culled reduction uploads these planes and mirrors `aabbInFrustum` in WGSL to
 * reject whole grid cells. Matches createPerspectiveMatrix — GL-style clip z in
 * [-w, w] — so the near/far planes use r3±r2; culling is conservative relative
 * to WebGPU's tighter [0, w] hardware clip (it never rejects a visible cell).
 */
import { multiplyMatrices } from '../../matrix.js';

// Row r of a column-major mat4 (element (row, col) lives at col*4 + row).
function row(m, r) { return [m[r], m[4 + r], m[8 + r], m[12 + r]]; }
function addv(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; }
function subv(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]]; }

function normalizePlane(p) {
    const len = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];
}

/** VP = proj · view (column-major). */
export function viewProjection(proj, view) {
    return multiplyMatrices(proj, view);
}

/**
 * Six world-space frustum planes [a, b, c, d] with the convention
 * `a*x + b*y + c*z + d >= 0` for points inside the frustum.
 * Order: left, right, bottom, top, near, far.
 * @param {Float32Array|number[]} vp column-major view-projection matrix
 */
export function extractFrustumPlanes(vp) {
    const r0 = row(vp, 0), r1 = row(vp, 1), r2 = row(vp, 2), r3 = row(vp, 3);
    return [
        normalizePlane(addv(r3, r0)), // left:   w + x >= 0
        normalizePlane(subv(r3, r0)), // right:  w - x >= 0
        normalizePlane(addv(r3, r1)), // bottom: w + y >= 0
        normalizePlane(subv(r3, r1)), // top:    w - y >= 0
        normalizePlane(addv(r3, r2)), // near:   w + z >= 0  (GL clip z in [-w, w])
        normalizePlane(subv(r3, r2)), // far:    w - z >= 0
    ];
}

/**
 * Conservative AABB-vs-frustum test using the positive-vertex method. Returns
 * false only when the box lies fully outside some plane, so it never produces a
 * false negative (never culls a box that is actually visible).
 * @param {number[][]} planes six [a,b,c,d] planes from extractFrustumPlanes
 * @param {number[]} min AABB min corner
 * @param {number[]} max AABB max corner
 */
export function aabbInFrustum(planes, min, max) {
    for (let i = 0; i < planes.length; i++) {
        const a = planes[i][0], b = planes[i][1], c = planes[i][2], d = planes[i][3];
        // Positive vertex: the AABB corner farthest along this plane's normal.
        const px = a >= 0 ? max[0] : min[0];
        const py = b >= 0 ? max[1] : min[1];
        const pz = c >= 0 ? max[2] : min[2];
        if (a * px + b * py + c * pz + d < 0) return false;
    }
    return true;
}
