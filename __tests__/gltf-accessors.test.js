import { createSequentialIndices, decodeGltfAccessor } from '../scripts/engine/gltf-accessors.js';
import { generateVertexNormals } from '../scripts/engine/gltf-geometry.js';

describe('glTF accessor decoding', () => {
  test('copies a misaligned, interleaved accessor into a tight float array', () => {
    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);
    [1, 2, 3, 99, 4, 5, 6, 99].forEach((value, index) => view.setFloat32(index * 4, value, true));
    const gltf = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 32, byteStride: 16 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: 'VEC3' }],
    };
    const decoded = decodeGltfAccessor(gltf, [buffer], 0);
    expect(decoded.data).toBeInstanceOf(Float32Array);
    expect([...decoded.data]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(decoded.data.buffer).not.toBe(buffer);
  });

  test('normalizes signed and unsigned integer components', () => {
    const buffer = new ArrayBuffer(10);
    new Int8Array(buffer, 0, 4).set([-128, -127, 0, 127]);
    new Uint16Array(buffer, 4, 3).set([0, 32768, 65535]);
    const gltf = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 4 },
        { buffer: 0, byteOffset: 4, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5120, normalized: true, count: 1, type: 'VEC4' },
        { bufferView: 1, componentType: 5123, normalized: true, count: 3, type: 'SCALAR' },
      ],
    };
    expect([...decodeGltfAccessor(gltf, [buffer], 0).data]).toEqual([-1, -1, 0, 1]);
    const unsigned = decodeGltfAccessor(gltf, [buffer], 1).data;
    expect(unsigned[0]).toBe(0);
    expect(unsigned[1]).toBeCloseTo(32768 / 65535);
    expect(unsigned[2]).toBe(1);
  });

  test('copies values from a deliberately misaligned accessor offset', () => {
    const buffer = new ArrayBuffer(10);
    const view = new DataView(buffer);
    view.setUint16(1, 12, true);
    view.setUint16(3, 34, true);
    const gltf = {
      bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5123, count: 2, type: 'SCALAR' }],
    };
    expect([...decodeGltfAccessor(gltf, [buffer], 0).data]).toEqual([12, 34]);
  });

  test('rejects sparse and out-of-range accessors with specific errors', () => {
    const buffer = new ArrayBuffer(4);
    const gltf = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR', sparse: {} }],
    };
    expect(() => decodeGltfAccessor(gltf, [buffer], 0)).toThrow(/sparse accessor/);
    delete gltf.accessors[0].sparse;
    gltf.accessors[0].count = 2;
    expect(() => decodeGltfAccessor(gltf, [buffer], 0)).toThrow(/beyond its bufferView/);
  });
});

describe('glTF generated geometry fallbacks', () => {
  test('chooses a sufficient sequential index type', () => {
    expect(createSequentialIndices(3)).toEqual(new Uint16Array([0, 1, 2]));
    const large = createSequentialIndices(65537);
    expect(large).toBeInstanceOf(Uint32Array);
    expect(large[65536]).toBe(65536);
  });

  test('generates normalized area-weighted vertex normals', () => {
    const normals = generateVertexNormals(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint16Array([0, 1, 2]),
    );
    expect([...normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
});
