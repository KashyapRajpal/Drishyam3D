export const U32_MAX = 0xffffffff;
export const INVALID_INDEX = U32_MAX;

export const VERTEX_SIZE = 48;
export const VERTEX_OFFSETS = Object.freeze({ position: 0, normal: 16, texCoord: 32 });

export const TRIANGLE_SIZE = 16;
export const TRIANGLE_OFFSETS = Object.freeze({ i0: 0, i1: 4, i2: 8, geometryIndex: 12 });

export const BVH_NODE_SIZE = 32;
export const BVH_NODE_OFFSETS = Object.freeze({ min: 0, leftFirst: 12, max: 16, primitiveCount: 28 });

export const INSTANCE_SIZE = 144;
export const INSTANCE_OFFSETS = Object.freeze({ worldMatrix: 0, inverseWorldMatrix: 64, blasRoot: 128, geometryIndex: 132, materialIndex: 136, flags: 140 });

export const MATERIAL_SIZE = 64;
export const MATERIAL_OFFSETS = Object.freeze({ baseColor: 0, emissive: 16, surface: 32, textureIndex: 48, flags: 52 });

export const FRAME_UNIFORM_SIZE = 192;
export const FRAME_UNIFORM_OFFSETS = Object.freeze({
    cameraPosition: 0,
    cameraRight: 16,
    cameraUp: 32,
    cameraForward: 48,
    dimensions: 64,
    renderSettings: 80,
    numerical: 96,
    environment: 112,
    lightPosition: 128,
    lightU: 144,
    lightV: 160,
    lightColor: 176,
});

export const DIAGNOSTICS_SIZE = 16;
export const INSTANCE_FLAG_FLIPS_HANDEDNESS = 1;
export const FRAME_FLAG_HAS_TLAS = 1;
export const LIGHT_TYPES = Object.freeze({ directional: 0, point: 1, rect: 2, rectangle: 2 });

function requireFiniteVector(value, length, label) {
    if (!value || value.length < length) throw new Error(`${label} requires ${length} values.`);
    for (let index = 0; index < length; index += 1) {
        if (!Number.isFinite(value[index])) throw new Error(`${label}[${index}] must be finite.`);
    }
}

function writeFloatVector(view, offset, value, length, label) {
    requireFiniteVector(value, length, label);
    for (let index = 0; index < length; index += 1) view.setFloat32(offset + index * 4, value[index], true);
}

function requireU32(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) throw new Error(`${label} must fit u32.`);
    return value;
}

/** Packs the one authoritative 192-byte FrameUniforms representation. */
export function packFrameUniforms({
    cameraFrame,
    width,
    height,
    sampleIndex = 0,
    frameSeed = 0,
    maxBounces = 1,
    samplesPerFrame = 1,
    lightType = 2,
    flags = 0,
    rayEpsilon = 1e-4,
    exposure = 1,
    environmentIntensity = 1,
    environment = [0, 0, 0],
    light = {},
} = {}) {
    if (!cameraFrame) throw new Error('Frame uniforms require a camera frame.');
    const buffer = new ArrayBuffer(FRAME_UNIFORM_SIZE);
    const view = new DataView(buffer);
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.cameraPosition, cameraFrame.eye, 3, 'camera position');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.cameraRight, cameraFrame.right, 3, 'camera right');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.cameraUp, cameraFrame.up, 3, 'camera up');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.cameraForward, cameraFrame.forward, 3, 'camera forward');
    view.setFloat32(FRAME_UNIFORM_OFFSETS.cameraForward + 12, cameraFrame.tanHalfFovY, true);
    [width, height, sampleIndex, frameSeed].forEach((value, index) => {
        view.setUint32(FRAME_UNIFORM_OFFSETS.dimensions + index * 4, requireU32(value, `dimensions[${index}]`), true);
    });
    const resolvedLightType = typeof lightType === 'string' ? LIGHT_TYPES[lightType] : lightType;
    [maxBounces, samplesPerFrame, resolvedLightType, flags].forEach((value, index) => {
        view.setUint32(FRAME_UNIFORM_OFFSETS.renderSettings + index * 4, requireU32(value, `renderSettings[${index}]`), true);
    });
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.numerical, [rayEpsilon, exposure, environmentIntensity], 3, 'numerical settings');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.environment, environment, 3, 'environment');
    const lightPosition = light.center || light.position || light.direction || [0, 0, 0];
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.lightPosition, lightPosition, 3, 'light position');
    view.setFloat32(FRAME_UNIFORM_OFFSETS.lightPosition + 12, light.intensity ?? 0, true);
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.lightU, light.u || [0, 0, 0], 3, 'light U');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.lightV, light.v || [0, 0, 0], 3, 'light V');
    writeFloatVector(view, FRAME_UNIFORM_OFFSETS.lightColor, light.color || [1, 1, 1], 3, 'light color');
    return buffer;
}
