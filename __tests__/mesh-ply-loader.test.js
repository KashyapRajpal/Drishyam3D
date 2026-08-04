import { parseMeshPly } from '../scripts/engine/mesh-ply-loader.js';

// DataView setters keyed by PLY type name, with byte sizes.
const WRITERS = {
  uchar: { size: 1, set: 'setUint8' },
  int:   { size: 4, set: 'setInt32' },
  uint:  { size: 4, set: 'setUint32' },
  float: { size: 4, set: 'setFloat32' },
};

/**
 * Encodes a binary_little_endian mesh PLY from ordered element specs:
 *   { name, props: [{ name, type } | { name, list: [countType, itemType] }], records: [{...}] }
 */
function encodeMeshPly(elements) {
  const headerLines = ['ply', 'format binary_little_endian 1.0'];
  for (const el of elements) {
    headerLines.push(`element ${el.name} ${el.records.length}`);
    for (const p of el.props) {
      headerLines.push(p.list ? `property list ${p.list[0]} ${p.list[1]} ${p.name}` : `property ${p.type} ${p.name}`);
    }
  }
  headerLines.push('end_header', '');
  const headerBytes = new TextEncoder().encode(headerLines.join('\n'));

  // Two passes: size, then write.
  let size = 0;
  const measure = (type) => { size += WRITERS[type].size; };
  for (const el of elements) {
    for (const rec of el.records) {
      for (const p of el.props) {
        if (p.list) { measure(p.list[0]); rec[p.name].forEach(() => measure(p.list[1])); }
        else measure(p.type);
      }
    }
  }

  const body = new ArrayBuffer(size);
  const dv = new DataView(body);
  let off = 0;
  const write = (type, value) => { const w = WRITERS[type]; dv[w.set](off, value, true); off += w.size; };
  for (const el of elements) {
    for (const rec of el.records) {
      for (const p of el.props) {
        if (p.list) { write(p.list[0], rec[p.name].length); rec[p.name].forEach((v) => write(p.list[1], v)); }
        else write(p.type, rec[p.name]);
      }
    }
  }

  const out = new Uint8Array(headerBytes.length + body.byteLength);
  out.set(headerBytes, 0);
  out.set(new Uint8Array(body), headerBytes.length);
  return out.buffer;
}

const XYZ = [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }];
const FACE_PROP = [{ name: 'vertex_indices', list: ['uchar', 'int'] }];
const MTV_PROPS = [{ name: 'tx', type: 'uchar' }, { name: 'u', type: 'float' }, { name: 'v', type: 'float' }];
const MTF_PROPS = [{ name: 'tx', type: 'uchar' }, { name: 'tn', type: 'uint' }, { name: 'texture_vertex_indices', list: ['uchar', 'int'] }];

describe('parseMeshPly', () => {
  test('parses a textured triangle (multi-texture indirect UVs)', () => {
    const buf = encodeMeshPly([
      { name: 'vertex', props: XYZ, records: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
      ] },
      { name: 'face', props: FACE_PROP, records: [{ vertex_indices: [0, 1, 2] }] },
      { name: 'multi_texture_vertex', props: MTV_PROPS, records: [
        { tx: 0, u: 0, v: 0 }, { tx: 0, u: 1, v: 0 }, { tx: 0, u: 0, v: 1 },
      ] },
      { name: 'multi_texture_face', props: MTF_PROPS, records: [{ tx: 0, tn: 0, texture_vertex_indices: [0, 1, 2] }] },
    ]);

    const m = parseMeshPly(buf);
    expect(m.hasTexture).toBe(true);
    expect(m.vertexCount).toBe(3);                       // index count
    expect(Array.from(m.indices)).toEqual([0, 1, 2]);
    expect(m.indices).toBeInstanceOf(Uint32Array);
    expect(m.indexFormat).toBe('uint32');
    expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.texCoords)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(m.colors).toBeNull();
    // CCW triangle in the z=0 plane -> +z normal.
    expect(Array.from(m.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(m.bounds.center).toEqual([1 / 3, 1 / 3, 0]);
  });

  test('parses per-vertex colors and triangulates a quad face', () => {
    const buf = encodeMeshPly([
      { name: 'vertex', props: [...XYZ,
        { name: 'red', type: 'uchar' }, { name: 'green', type: 'uchar' }, { name: 'blue', type: 'uchar' }], records: [
        { x: 0, y: 0, z: 0, red: 255, green: 0, blue: 0 },
        { x: 1, y: 0, z: 0, red: 0, green: 255, blue: 0 },
        { x: 1, y: 1, z: 0, red: 0, green: 0, blue: 255 },
        { x: 0, y: 1, z: 0, red: 255, green: 255, blue: 255 },
      ] },
      { name: 'face', props: FACE_PROP, records: [{ vertex_indices: [0, 1, 2, 3] }] }, // quad
    ]);

    const m = parseMeshPly(buf);
    expect(m.hasTexture).toBe(false);
    // Quad -> fan -> 2 triangles -> 6 indices, but only 4 unique vertices.
    expect(m.vertexCount).toBe(6);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(m.positions).toHaveLength(4 * 3);
    expect(Array.from(m.colors.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(m.texCoords)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('splits a shared vertex across a UV seam into distinct output vertices', () => {
    // Two triangles share edge (v1,v2); vertex 2 gets a different tex-vertex in
    // each face (indices 2 vs 4), so it must become two output vertices.
    const buf = encodeMeshPly([
      { name: 'vertex', props: XYZ, records: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 },
      ] },
      { name: 'face', props: FACE_PROP, records: [
        { vertex_indices: [0, 1, 2] }, { vertex_indices: [1, 3, 2] },
      ] },
      { name: 'multi_texture_vertex', props: MTV_PROPS, records: [
        { tx: 0, u: 0, v: 0 }, { tx: 0, u: 1, v: 0 }, { tx: 0, u: 1, v: 1 },
        { tx: 0, u: 0.5, v: 0 }, { tx: 0, u: 0.9, v: 1 },
      ] },
      { name: 'multi_texture_face', props: MTF_PROPS, records: [
        { tx: 0, tn: 0, texture_vertex_indices: [0, 1, 2] },
        { tx: 0, tn: 0, texture_vertex_indices: [1, 3, 4] }, // vertex 2 -> tex-vertex 4 (seam)
      ] },
    ]);

    const m = parseMeshPly(buf);
    expect(m.vertexCount).toBe(6);            // 2 triangles
    // 6 corners, one (vertex,texvertex) pair repeats (vertex 1 shares tex-vertex 1),
    // so unique output vertices = 5.
    expect(m.positions).toHaveLength(5 * 3);
  });

  test('rejects a non-mesh (splat) PLY', () => {
    const buf = encodeMeshPly([
      { name: 'vertex', props: XYZ, records: [{ x: 0, y: 0, z: 0 }] },
    ]);
    expect(() => parseMeshPly(buf)).toThrow(/not a triangle mesh/);
  });
});
