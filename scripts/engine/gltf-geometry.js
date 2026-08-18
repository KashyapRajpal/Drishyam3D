/** Pure geometry fallbacks used while extracting glTF triangle meshes. */

export function generateVertexNormals(positions, indices) {
    if (!positions || positions.length % 3 !== 0) throw new Error('Positions must contain complete xyz vertices.');
    if (!indices || indices.length % 3 !== 0) throw new Error('Indices must contain complete triangles.');
    const vertexCount = positions.length / 3;
    const normals = new Float32Array(positions.length);
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const i0 = indices[triangle];
        const i1 = indices[triangle + 1];
        const i2 = indices[triangle + 2];
        if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
            throw new Error(`Triangle ${triangle / 3} contains an out-of-range index.`);
        }
        const a = i0 * 3;
        const b = i1 * 3;
        const c = i2 * 3;
        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const abz = positions[b + 2] - positions[a + 2];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const acz = positions[c + 2] - positions[a + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        for (const offset of [a, b, c]) {
            normals[offset] += nx;
            normals[offset + 1] += ny;
            normals[offset + 2] += nz;
        }
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const offset = vertex * 3;
        const length = Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]);
        if (length > 1e-12) {
            normals[offset] /= length;
            normals[offset + 1] /= length;
            normals[offset + 2] /= length;
        } else {
            normals[offset + 1] = 1;
        }
    }
    return normals;
}
