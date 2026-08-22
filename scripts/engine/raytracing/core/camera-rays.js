/**
 * Pure camera-frame and ray-generation helpers shared by CPU tests and GPU packing.
 */

function normalize(v, label) {
    const length = Math.hypot(v[0], v[1], v[2]);
    if (!Number.isFinite(length) || length < 1e-12) {
        throw new Error(`Cannot normalize ${label}.`);
    }
    return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

export function createCameraFrame({ eye, target, up, fovY, aspect }) {
    if (![...eye, ...target, ...up, fovY, aspect].every(Number.isFinite)) {
        throw new Error('Camera frame contains non-finite values.');
    }
    if (!(fovY > 0 && fovY < Math.PI) || !(aspect > 0)) {
        throw new Error('Camera frame requires 0 < fovY < PI and aspect > 0.');
    }
    const forward = normalize([
        target[0] - eye[0],
        target[1] - eye[1],
        target[2] - eye[2],
    ], 'camera forward vector');
    const right = normalize(cross(forward, up), 'camera right vector (up is parallel to forward)');
    const correctedUp = cross(right, forward);
    return {
        eye: [...eye],
        forward,
        right,
        up: correctedUp,
        fovY,
        aspect,
        tanHalfFovY: Math.tan(fovY / 2),
    };
}

export function generateCameraRay(cameraFrame, pixelX, pixelY, width, height, jitter = [0.5, 0.5]) {
    if (!(width > 0 && height > 0)) throw new Error('Ray dimensions must be positive.');
    if (![pixelX, pixelY, jitter[0], jitter[1]].every(Number.isFinite)) {
        throw new Error('Ray coordinates and jitter must be finite.');
    }
    const ndcX = 2 * ((pixelX + jitter[0]) / width) - 1;
    const ndcY = 1 - 2 * ((pixelY + jitter[1]) / height);
    const x = ndcX * cameraFrame.aspect * cameraFrame.tanHalfFovY;
    const y = ndcY * cameraFrame.tanHalfFovY;
    const direction = normalize([
        cameraFrame.forward[0] + cameraFrame.right[0] * x + cameraFrame.up[0] * y,
        cameraFrame.forward[1] + cameraFrame.right[1] * x + cameraFrame.up[1] * y,
        cameraFrame.forward[2] + cameraFrame.right[2] * x + cameraFrame.up[2] * y,
    ], 'camera ray direction');
    return { origin: [...cameraFrame.eye], direction };
}
