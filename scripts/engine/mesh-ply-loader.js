/**
 * @file Pure parser for binary triangle-mesh `.ply` files (as opposed to the
 *       3D-Gaussian-splat `.ply` handled by ply-loader.js).
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Handles the generic mesh layout plus the Artec 3D-scanner multi-texture
 * extension:
 *   element vertex              x y z [red green blue] [nx ny nz]
 *   element face                list vertex_indices
 *   element multi_texture_vertex   tx u v            (texture coordinates)
 *   element multi_texture_face     tx tn list texture_vertex_indices
 *
 * UVs are indexed indirectly: each face carries its own texture-vertex indices,
 * so a mesh vertex can have different UVs in different faces (texture seams). We
 * resolve this by de-duplicating on the (vertexIndex, texVertexIndex) pair,
 * producing one GPU vertex per unique corner and a Uint32 index buffer.
 *
 * Like ply-loader.js this is GPU-free: it returns plain typed arrays the facade
 * uploads. It does NOT reorient the scene (no axis flip).
 */

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
 * Parses the ASCII header into an ordered list of elements and their properties.
 * @param {Uint8Array} bytes
 */
function parseHeader(bytes) {
    const headerLimit = Math.min(bytes.length, 128 * 1024);
    const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, headerLimit));
    const terminatorIdx = headerText.indexOf(HEADER_TERMINATOR);
    if (terminatorIdx === -1) throw new Error('Invalid PLY: missing "end_header".');
    const dataOffset = terminatorIdx + HEADER_TERMINATOR.length;

    const lines = headerText.slice(0, terminatorIdx).split('\n').map((l) => l.replace(/\r$/, '').trim());
    if (lines[0] !== 'ply') throw new Error('Invalid PLY: missing "ply" magic.');

    let littleEndian = true;
    const elements = [];
    let current = null;

    for (const line of lines) {
        if (line.startsWith('format ')) {
            const fmt = line.split(/\s+/)[1];
            if (fmt === 'ascii') throw new Error('ASCII PLY is not supported; expected binary_little_endian.');
            littleEndian = fmt !== 'binary_big_endian';
        } else if (line.startsWith('element ')) {
            const [, name, count] = line.split(/\s+/);
            current = { name, count: parseInt(count, 10), props: [] };
            elements.push(current);
        } else if (line.startsWith('property ') && current) {
            const parts = line.split(/\s+/);
            if (parts[1] === 'list') {
                // property list <countType> <itemType> <name>
                const countType = PLY_TYPES[parts[2]];
                const itemType = PLY_TYPES[parts[3]];
                if (!countType || !itemType) throw new Error(`Unsupported PLY list types: ${parts[2]} ${parts[3]}`);
                current.props.push({ name: parts[4], list: { countType, itemType } });
            } else {
                const type = PLY_TYPES[parts[1]];
                if (!type) throw new Error(`Unsupported PLY property type: ${parts[1]}`);
                current.props.push({ name: parts[2], type });
            }
        }
    }

    return { elements, dataOffset, littleEndian };
}

/**
 * Parses a binary triangle-mesh `.ply` ArrayBuffer.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{
 *   positions: Float32Array, normals: Float32Array, texCoords: Float32Array,
 *   colors: Float32Array|null, indices: Uint32Array, vertexCount: number,
 *   indexFormat: 'uint32', hasTexture: boolean,
 *   bounds: { center: [number,number,number], radius: number } | null
 * }}  `vertexCount` is the number of INDICES to draw (indices.length).
 */
export function parseMeshPly(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const { elements, dataOffset, littleEndian } = parseHeader(bytes);
    const view = new DataView(arrayBuffer);
    const LE = littleEndian;
    let cursor = dataOffset;

    const readScalar = (type) => {
        const v = view[type.get](cursor, LE);
        cursor += type.size;
        return v;
    };

    // Reads one record of `el`, returning a { propName: value | number[] } object.
    const readRecord = (el) => {
        const rec = {};
        for (const p of el.props) {
            if (p.list) {
                const n = readScalar(p.list.countType);
                const arr = new Array(n);
                for (let j = 0; j < n; j++) arr[j] = readScalar(p.list.itemType);
                rec[p.name] = arr;
            } else {
                rec[p.name] = readScalar(p.type);
            }
        }
        return rec;
    };

    let srcPositions = null, srcColors = null, srcNormals = null, srcVertexCount = 0;
    const faces = [];       // triangles as [v0, v1, v2] (indices into srcPositions)
    const texFaces = [];    // parallel triangles as [t0, t1, t2] (indices into mtv*)
    let mtvU = null, mtvV = null;

    for (const el of elements) {
        if (el.name === 'vertex') {
            srcVertexCount = el.count;
            srcPositions = new Float32Array(el.count * 3);
            const hasColor = el.props.some((p) => p.name === 'red');
            const hasNormal = el.props.some((p) => p.name === 'nx');
            if (hasColor) srcColors = new Float32Array(el.count * 3);
            if (hasNormal) srcNormals = new Float32Array(el.count * 3);
            for (let i = 0; i < el.count; i++) {
                const r = readRecord(el);
                srcPositions[i * 3] = r.x; srcPositions[i * 3 + 1] = r.y; srcPositions[i * 3 + 2] = r.z;
                if (hasColor) { srcColors[i * 3] = r.red / 255; srcColors[i * 3 + 1] = r.green / 255; srcColors[i * 3 + 2] = r.blue / 255; }
                if (hasNormal) { srcNormals[i * 3] = r.nx; srcNormals[i * 3 + 1] = r.ny; srcNormals[i * 3 + 2] = r.nz; }
            }
        } else if (el.name === 'face') {
            for (let i = 0; i < el.count; i++) {
                const idx = readRecord(el).vertex_indices;
                for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]); // fan-triangulate
            }
        } else if (el.name === 'multi_texture_vertex') {
            mtvU = new Float32Array(el.count);
            mtvV = new Float32Array(el.count);
            for (let i = 0; i < el.count; i++) {
                const r = readRecord(el);
                mtvU[i] = r.u; mtvV[i] = r.v;
            }
        } else if (el.name === 'multi_texture_face') {
            for (let i = 0; i < el.count; i++) {
                const idx = readRecord(el).texture_vertex_indices;
                for (let k = 1; k + 1 < idx.length; k++) texFaces.push([idx[0], idx[k], idx[k + 1]]);
            }
        } else {
            for (let i = 0; i < el.count; i++) readRecord(el); // skip unknown element
        }
    }

    if (!srcPositions || faces.length === 0) {
        throw new Error('PLY is not a triangle mesh (no vertex/face data).');
    }

    const hasTexture = !!(mtvU && texFaces.length === faces.length);
    const mtvCount = mtvU ? mtvU.length : 0;

    // De-duplicate corners. Textured meshes key on (vertexIndex, texVertexIndex)
    // to preserve UV seams; otherwise the mesh vertices are used directly.
    const dedup = new Map();
    const maxOut = faces.length * 3;
    const outPos = new Float32Array(maxOut * 3);
    const outUV = new Float32Array(maxOut * 2);
    const outCol = srcColors ? new Float32Array(maxOut * 3) : null;
    const indices = new Uint32Array(maxOut);
    let outN = 0;

    for (let f = 0; f < faces.length; f++) {
        const vTri = faces[f];
        const tTri = hasTexture ? texFaces[f] : null;
        for (let c = 0; c < 3; c++) {
            const vIdx = vTri[c];
            const tIdx = tTri ? tTri[c] : 0;
            const key = hasTexture ? vIdx * mtvCount + tIdx : vIdx;
            let outIdx = dedup.get(key);
            if (outIdx === undefined) {
                outIdx = outN++;
                dedup.set(key, outIdx);
                outPos[outIdx * 3] = srcPositions[vIdx * 3];
                outPos[outIdx * 3 + 1] = srcPositions[vIdx * 3 + 1];
                outPos[outIdx * 3 + 2] = srcPositions[vIdx * 3 + 2];
                if (hasTexture) { outUV[outIdx * 2] = mtvU[tIdx]; outUV[outIdx * 2 + 1] = mtvV[tIdx]; }
                if (outCol) { outCol[outIdx * 3] = srcColors[vIdx * 3]; outCol[outIdx * 3 + 1] = srcColors[vIdx * 3 + 1]; outCol[outIdx * 3 + 2] = srcColors[vIdx * 3 + 2]; }
            }
            indices[f * 3 + c] = outIdx;
        }
    }

    const positions = outPos.slice(0, outN * 3);
    const texCoords = outUV.slice(0, outN * 2);
    const colors = outCol ? outCol.slice(0, outN * 3) : null;

    // Remap file-provided normals when they map cleanly to output vertices
    // (non-textured meshes key the de-dup on the plain vertex index); otherwise
    // derive area-weighted normals from the triangles.
    let normals;
    if (srcNormals && !hasTexture) {
        normals = new Float32Array(outN * 3);
        dedup.forEach((outIdx, vIdx) => {
            normals[outIdx * 3] = srcNormals[vIdx * 3];
            normals[outIdx * 3 + 1] = srcNormals[vIdx * 3 + 1];
            normals[outIdx * 3 + 2] = srcNormals[vIdx * 3 + 2];
        });
    } else {
        normals = computeNormals(positions, indices, outN);
    }

    return {
        positions, normals, texCoords, colors, indices,
        vertexCount: indices.length,
        indexFormat: 'uint32', // indices is a Uint32Array (meshes routinely exceed 65 535 verts)
        hasTexture,
        bounds: computeBounds(srcPositions, srcVertexCount),
    };
}

/** Area-weighted per-output-vertex normals derived from the triangles. */
function computeNormals(positions, indices, count) {
    const normals = new Float32Array(count * 3);

    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2];
        const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
        const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
        const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        // Cross product (not normalized — magnitude weights by triangle area).
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
        normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
        normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
    }

    for (let i = 0; i < count; i++) {
        const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
        const len = Math.hypot(x, y, z);
        if (len > 1e-8) { normals[i * 3] = x / len; normals[i * 3 + 1] = y / len; normals[i * 3 + 2] = z / len; }
        else { normals[i * 3] = 0; normals[i * 3 + 1] = 0; normals[i * 3 + 2] = 1; }
    }
    return normals;
}

function computeBounds(positions, count) {
    if (count === 0) return null;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < count; i++) { cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2]; }
    const center = [cx / count, cy / count, cz / count];
    let radius = 0;
    for (let i = 0; i < count; i++) {
        const d = Math.hypot(positions[i * 3] - center[0], positions[i * 3 + 1] - center[1], positions[i * 3 + 2] - center[2]);
        if (d > radius) radius = d;
    }
    return { center, radius };
}
