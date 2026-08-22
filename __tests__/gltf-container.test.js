import {
  GLB_BIN_CHUNK,
  GLB_JSON_CHUNK,
  GLB_MAGIC,
  isGlb,
  parseGlb,
  parseGltfContainer,
} from '../scripts/engine/gltf-container.js';

function makeGlb(json, binary = null) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.byteLength / 4) * 4 : 0;
  const total = 12 + 8 + jsonLength + (binary ? 8 + binaryLength : 0);
  const output = new ArrayBuffer(total);
  const view = new DataView(output);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  new Uint8Array(output, 20, jsonLength).fill(0x20);
  new Uint8Array(output, 20, encoded.length).set(encoded);
  if (binary) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, GLB_BIN_CHUNK, true);
    new Uint8Array(output, offset + 8, binary.byteLength).set(new Uint8Array(binary));
  }
  return output;
}

describe('glTF container parsing', () => {
  test('parses GLB v2 JSON and BIN chunks', () => {
    const binary = new Uint8Array([1, 2, 3]).buffer;
    const glb = makeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 3 }] }, binary);
    expect(isGlb(glb)).toBe(true);
    const parsed = parseGltfContainer(glb);
    expect(parsed.json.asset.version).toBe('2.0');
    expect([...new Uint8Array(parsed.binaryChunk).subarray(0, 3)]).toEqual([1, 2, 3]);
  });

  test('parses plain JSON through the same entry point', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
    expect(parseGltfContainer(bytes.buffer)).toEqual({
      json: { asset: { version: '2.0' } },
      binaryChunk: null,
    });
  });

  test.each([
    ['version', (glb) => new DataView(glb).setUint32(4, 1, true), /version 1/],
    ['declared length', (glb) => new DataView(glb).setUint32(8, glb.byteLength - 4, true), /declared length/],
    ['first chunk type', (glb) => new DataView(glb).setUint32(16, GLB_BIN_CHUNK, true), /first chunk must be JSON/],
    ['chunk range', (glb) => new DataView(glb).setUint32(12, glb.byteLength, true), /exceeds the declared length/],
  ])('rejects a malformed GLB %s', (_name, mutate, expected) => {
    const glb = makeGlb({ asset: { version: '2.0' } });
    mutate(glb);
    expect(() => parseGlb(glb)).toThrow(expected);
  });
});
