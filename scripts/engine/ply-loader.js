/**
 * @file Pure parser for binary 3D Gaussian Splatting `.ply` files.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * No GPU dependency — returns plain typed arrays (mirrors the data/GPU split in
 * geometry.js). This is the single function boundary a future WASM module can
 * replace without touching the renderer or shaders (see docs/gaussian-splatting-plan.md).
 */

// Zeroth-order spherical-harmonic constant: color = 0.5 + SH_C0 * f_dc.
export const SH_C0 = 0.28209479177387814;

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Non-DC SH coefficients per colour channel, by degree (3 for deg 1, +5 for deg 2, +7 for deg 3).
export const SH_REST_PER_CHANNEL = { 0: 0, 1: 3, 2: 8, 3: 15 };

/**
 * Per-channel indices of the non-DC SH basis functions that are ODD in y.
 *
 * parsePly mirrors the scene about the y axis (see the Y-flip below). Spherical
 * harmonics are fit in the original space, so evaluating them against a view
 * direction in the mirrored space is wrong unless the basis functions that
 * change sign under y -> -y have their coefficients negated to match:
 *   deg 1: Y(1,-1) ~ y                     -> index 0
 *   deg 2: Y(2,-2) ~ xy, Y(2,-1) ~ yz      -> indices 3, 4
 *   deg 3: Y(3,-3) ~ y(3x²-y²),
 *          Y(3,-2) ~ xyz,
 *          Y(3,-1) ~ y(4z²-x²-y²)          -> indices 8, 9, 10
 */
export const SH_REST_FLIP_Y = new Set([0, 3, 4, 8, 9, 10]);

/** Highest SH degree fully covered by `restPerChannel` stored coefficients. */
export function shDegreeFromRestCount(restPerChannel) {
    if (restPerChannel >= 15) return 3;
    if (restPerChannel >= 8) return 2;
    if (restPerChannel >= 3) return 1;
    return 0;
}

// PLY property type -> { size in bytes, DataView getter name }.
const PLY_TYPES = {
    char:   { size: 1, get: 'getInt8' },
    uchar:  { size: 1, get: 'getUint8' },
    int8:   { size: 1, get: 'getInt8' },
    uint8:  { size: 1, get: 'getUint8' },
    short:  { size: 2, get: 'getInt16' },
    ushort: { size: 2, get: 'getUint16' },
    int16:  { size: 2, get: 'getInt16' },
    uint16: { size: 2, get: 'getUint16' },
    int:    { size: 4, get: 'getInt32' },
    uint:   { size: 4, get: 'getUint32' },
    int32:  { size: 4, get: 'getInt32' },
    uint32: { size: 4, get: 'getUint32' },
    float:  { size: 4, get: 'getFloat32' },
    float32:{ size: 4, get: 'getFloat32' },
    double: { size: 8, get: 'getFloat64' },
    float64:{ size: 8, get: 'getFloat64' },
};

const HEADER_TERMINATOR = 'end_header\n';

/**
 * Parses the ASCII header of a `.ply` buffer.
 * @param {Uint8Array} bytes
 * @returns {{ vertexCount: number, properties: Array<{name:string,type:object}>, stride: number, dataOffset: number, littleEndian: boolean }}
 */
function parseHeader(bytes) {
    // Locate the end of the header without decoding the whole (possibly huge) buffer.
    const headerLimit = Math.min(bytes.length, 64 * 1024);
    const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, headerLimit));
    const terminatorIdx = headerText.indexOf(HEADER_TERMINATOR);
    if (terminatorIdx === -1) {
        throw new Error('Invalid PLY: missing "end_header".');
    }
    const dataOffset = terminatorIdx + HEADER_TERMINATOR.length;

    const lines = headerText.slice(0, terminatorIdx).split('\n').map((l) => l.replace(/\r$/, '').trim());
    if (lines[0] !== 'ply') {
        throw new Error('Invalid PLY: missing "ply" magic.');
    }

    let littleEndian = true;
    let vertexCount = 0;
    let inVertexElement = false;
    const properties = [];

    for (const line of lines) {
        if (line.startsWith('format ')) {
            const fmt = line.split(/\s+/)[1];
            if (fmt === 'ascii') {
                throw new Error('ASCII PLY is not supported; expected binary_little_endian.');
            }
            littleEndian = fmt !== 'binary_big_endian';
        } else if (line.startsWith('element ')) {
            const [, name, count] = line.split(/\s+/);
            inVertexElement = name === 'vertex';
            if (inVertexElement) vertexCount = parseInt(count, 10);
        } else if (line.startsWith('property ') && inVertexElement) {
            const parts = line.split(/\s+/);
            // "property <type> <name>" — list properties are unsupported for vertex data.
            if (parts[1] === 'list') {
                throw new Error('Unsupported PLY list property in vertex element.');
            }
            const type = PLY_TYPES[parts[1]];
            if (!type) throw new Error(`Unsupported PLY property type: ${parts[1]}`);
            properties.push({ name: parts[2], type });
        }
    }

    const stride = properties.reduce((sum, p) => sum + p.type.size, 0);
    return { vertexCount, properties, stride, dataOffset, littleEndian };
}

/**
 * Parses a binary 3DGS `.ply` ArrayBuffer into plain typed arrays with
 * activations applied (opacity=sigmoid, scale=exp, rotation normalized,
 * color from SH degree-0).
 *
 * Non-DC spherical harmonics (`f_rest_*`) are read when present. In the file they
 * are channel-major (`f_rest_0..14` = R, `15..29` = G, `30..44` = B for degree 3);
 * `shCoeffs` re-interleaves them coefficient-major as consecutive rgb triples so
 * the shader can read one vec3 per coefficient.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{
 *   positions: Float32Array, colors: Float32Array, opacities: Float32Array,
 *   scales: Float32Array, rotations: Float32Array, count: number,
 *   shCoeffs: Float32Array|null, shDegree: number,
 *   bounds: { center: [number,number,number], radius: number } | null
 * }}
 */
export function parsePly(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const { vertexCount, properties, stride, dataOffset, littleEndian } = parseHeader(bytes);

    if (dataOffset + vertexCount * stride > bytes.length) {
        throw new Error('Invalid PLY: binary body shorter than header declares.');
    }

    // Per-property byte offset within a vertex record.
    const offsets = {};
    let running = 0;
    for (const p of properties) {
        offsets[p.name] = { off: running, get: p.type.get };
        running += p.type.size;
    }

    const view = new DataView(arrayBuffer, dataOffset);
    const has = (name) => name in offsets;
    const read = (base, name) => {
        const p = offsets[name];
        return view[p.get](base + p.off, littleEndian);
    };

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const opacities = new Float32Array(vertexCount);
    const scales = new Float32Array(vertexCount * 3);
    const rotations = new Float32Array(vertexCount * 4);

    // --- Non-DC spherical harmonics ---------------------------------------
    // Count the contiguous f_rest_* run, then keep only the coefficients of the
    // highest degree the file fully covers (a partial degree is unusable).
    let restCount = 0;
    while (has(`f_rest_${restCount}`)) restCount++;
    const restPerChannel = Math.floor(restCount / 3);
    const shDegree = shDegreeFromRestCount(restPerChannel);
    const shPerChannel = SH_REST_PER_CHANNEL[shDegree];

    // Resolve the DataView accessors once, in output order (coefficient-major
    // rgb triples), instead of rebuilding `f_rest_N` strings per vertex.
    const shReaders = [];
    const shSigns = [];
    for (let k = 0; k < shPerChannel; k++) {
        const sign = SH_REST_FLIP_Y.has(k) ? -1 : 1;
        for (let c = 0; c < 3; c++) {
            shReaders.push(offsets[`f_rest_${c * restPerChannel + k}`]);
            shSigns.push(sign);
        }
    }
    const shStride = shPerChannel * 3;
    const shCoeffs = shPerChannel > 0 ? new Float32Array(vertexCount * shStride) : null;

    let cx = 0, cy = 0, cz = 0;

    for (let i = 0; i < vertexCount; i++) {
        const base = i * stride;

        const x = has('x') ? read(base, 'x') : 0;
        const y = has('y') ? read(base, 'y') : 0;
        const z = has('z') ? read(base, 'z') : 0;
        // Flip Y axis: standard 3DGS scenes are Y-up, but we need to handle inverted captures.
        positions[i * 3 + 0] = x;
        positions[i * 3 + 1] = -y;
        positions[i * 3 + 2] = z;
        cx += x; cy += -y; cz += z;

        // Color from SH degree-0 DC term (default mid-grey if absent).
        colors[i * 3 + 0] = has('f_dc_0') ? 0.5 + SH_C0 * read(base, 'f_dc_0') : 0.5;
        colors[i * 3 + 1] = has('f_dc_1') ? 0.5 + SH_C0 * read(base, 'f_dc_1') : 0.5;
        colors[i * 3 + 2] = has('f_dc_2') ? 0.5 + SH_C0 * read(base, 'f_dc_2') : 0.5;

        opacities[i] = has('opacity') ? sigmoid(read(base, 'opacity')) : 1;

        scales[i * 3 + 0] = has('scale_0') ? Math.exp(read(base, 'scale_0')) : 1;
        scales[i * 3 + 1] = has('scale_1') ? Math.exp(read(base, 'scale_1')) : 1;
        scales[i * 3 + 2] = has('scale_2') ? Math.exp(read(base, 'scale_2')) : 1;

        // Rotation quaternion stored as (rot_0..3); normalize and canonicalize (qw > 0).
        let qw = has('rot_0') ? read(base, 'rot_0') : 1;
        let qx = has('rot_1') ? read(base, 'rot_1') : 0;
        let qy = has('rot_2') ? read(base, 'rot_2') : 0;
        let qz = has('rot_3') ? read(base, 'rot_3') : 0;
        const len = Math.hypot(qw, qx, qy, qz) || 1;
        qw /= len;
        qx /= len;
        qy /= len;
        qz /= len;
        // Ensure qw >= 0 (canonical form; q and -q are equivalent, but we pick the shorter arc).
        if (qw < 0) {
            qw = -qw;
            qx = -qx;
            qy = -qy;
            qz = -qz;
        }
        rotations[i * 4 + 0] = qw;
        rotations[i * 4 + 1] = qx;
        rotations[i * 4 + 2] = qy;
        rotations[i * 4 + 3] = qz;

        // SH rest terms, sign-corrected for the Y-flip above.
        if (shCoeffs) {
            const shBase = i * shStride;
            for (let n = 0; n < shStride; n++) {
                const p = shReaders[n];
                shCoeffs[shBase + n] = shSigns[n] * view[p.get](base + p.off, littleEndian);
            }
        }
    }

    let bounds = null;
    if (vertexCount > 0) {
        const center = [cx / vertexCount, cy / vertexCount, cz / vertexCount];
        let radius = 0;
        for (let i = 0; i < vertexCount; i++) {
            const dx = positions[i * 3] - center[0];
            const dy = positions[i * 3 + 1] - center[1];
            const dz = positions[i * 3 + 2] - center[2];
            const d = Math.hypot(dx, dy, dz);
            if (d > radius) radius = d;
        }
        bounds = { center, radius };
    }

    return {
        positions, colors, opacities, scales, rotations,
        count: vertexCount, shCoeffs, shDegree, bounds,
    };
}
