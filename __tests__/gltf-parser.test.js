import { assetToRasterPrimitives, assetToRayScene, parseGltfAsset, parseGltfForBackend } from '../scripts/engine/gltf-parser.js';
import { GLB_BIN_CHUNK, GLB_JSON_CHUNK, GLB_MAGIC } from '../scripts/engine/gltf-container.js';
import { transformPoint } from '../scripts/engine/matrix.js';
import { validateRayScene } from '../scripts/engine/raytracing/core/ray-scene.js';

function file(bytes) {
  return { arrayBuffer: jest.fn(async () => bytes instanceof ArrayBuffer ? bytes : bytes.buffer) };
}

function singleTriangleFiles() {
  const binary = new ArrayBuffer(104);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(binary, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Float32Array(binary, 72, 6).set([0, 0, 1, 0, 0, 1]);
  new Uint16Array(binary, 96, 3).set([0, 1, 2]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'triangle.bin', byteLength: 104 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 },
      { buffer: 0, byteOffset: 96, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0.1, roughnessFactor: 0.7,
      },
      emissiveFactor: [0.01, 0.02, 0.03],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  return new Map([
    ['model/triangle.gltf', file(jsonBytes)],
    ['model/triangle.bin', file(binary)],
  ]);
}

function instancedSceneFiles({ selectUnsupportedScene = false, cycle = false } = {}) {
  const binary = new ArrayBuffer(160);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(binary, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Uint16Array(binary, 72, 3).set([0, 1, 2]);
  new Float32Array(binary, 80, 9).set([0, 0, 1, 1, 0, 1, 0, 1, 1]);
  new Float32Array(binary, 116, 9).set([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  new Uint16Array(binary, 152, 3).set([0, 1, 2]);
  const gltf = {
    asset: { version: '2.0' },
    scene: selectUnsupportedScene ? 0 : 1,
    scenes: [{ nodes: [2] }, { nodes: [0] }],
    nodes: [
      {
        name: 'scaled-parent',
        mesh: 0,
        children: [1],
        translation: [10, 0, 0],
        rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 3, 4],
      },
      {
        name: 'matrix-child',
        mesh: 0,
        children: cycle ? [0] : [],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1],
        translation: [999, 999, 999],
      },
      { name: 'unselected-lines', mesh: 1 },
    ],
    buffers: [{ uri: 'scene.bin', byteLength: 160 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
      { buffer: 0, byteOffset: 80, byteLength: 36 },
      { buffer: 0, byteOffset: 116, byteLength: 36 },
      { buffer: 0, byteOffset: 152, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 5, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1], metallicFactor: 0.2, roughnessFactor: 0.4 } },
    ],
    meshes: [
      { name: 'instanced-pair', primitives: [
        { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        { attributes: { POSITION: 3, NORMAL: 4 }, indices: 5, material: 1 },
      ] },
      { name: 'ignored-lines', primitives: [
        { mode: 1, attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
      ] },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  return new Map([
    ['nested/scene.gltf', file(jsonBytes)],
    ['nested/scene.bin', file(binary)],
  ]);
}

function filesFromDocument(gltf, buffers, mainName = 'model.gltf') {
  const entries = [[mainName, file(new TextEncoder().encode(JSON.stringify(gltf)))]];
  gltf.buffers.forEach((buffer, index) => entries.push([buffer.uri, file(buffers[index])]));
  return new Map(entries);
}

function robustAccessorFiles() {
  const positions = new ArrayBuffer(48);
  const positionView = new DataView(positions);
  [0, 0, 0, 99, 1, 0, 0, 99, 0, 1, 0, 99]
    .forEach((value, index) => positionView.setFloat32(index * 4, value, true));
  const attributes = new ArrayBuffer(36);
  new Int8Array(attributes, 0, 12).set([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]);
  new Uint16Array(attributes, 12, 6).set([0, 0, 65535, 0, 0, 65535]);
  new Uint32Array(attributes, 24, 3).set([0, 1, 2]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [
      { uri: 'positions.bin', byteLength: positions.byteLength },
      { uri: 'attributes.bin', byteLength: attributes.byteLength },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 16 },
      { buffer: 1, byteOffset: 0, byteLength: 12, byteStride: 4 },
      { buffer: 1, byteOffset: 12, byteLength: 12 },
      { buffer: 1, byteOffset: 24, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, normalized: true, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
  };
  return filesFromDocument(gltf, [positions, attributes]);
}

function missingGeometryDataFiles() {
  const binary = new ArrayBuffer(36);
  new Float32Array(binary).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'positions.bin', byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  };
  return filesFromDocument(gltf, [binary]);
}

function makeTriangleGlb() {
  const binary = new ArrayBuffer(84);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(binary, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Uint32Array(binary, 72, 3).set([0, 1, 2]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 84 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  new Uint8Array(glb, 20, jsonLength).fill(0x20);
  new Uint8Array(glb, 20, jsonBytes.length).set(jsonBytes);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, GLB_BIN_CHUNK, true);
  new Uint8Array(glb, binaryHeader + 8).set(new Uint8Array(binary));
  return glb;
}

function deferredFeatureFiles(feature) {
  const binary = new ArrayBuffer(80);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(binary, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Uint16Array(binary, 72, 3).set([0, 1, 2]);
  const primitive = { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 };
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'mesh.bin', byteLength: 80 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{}],
    meshes: [{ primitives: [primitive] }],
  };
  if (feature === 'sparse') gltf.accessors[0].sparse = { count: 1 };
  if (feature === 'draco') gltf.extensionsUsed = ['KHR_draco_mesh_compression'];
  if (feature === 'meshopt') gltf.bufferViews[0].extensions = { EXT_meshopt_compression: {} };
  if (feature === 'skin') {
    gltf.scenes = [{ nodes: [0] }]; gltf.nodes = [{ mesh: 0, skin: 0 }]; gltf.skins = [{}];
  }
  if (feature === 'morph') primitive.targets = [{ POSITION: 0 }];
  if (feature === 'alpha') gltf.materials[0].alphaMode = 'BLEND';
  return filesFromDocument(gltf, [binary]);
}

function webgl() {
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    createBuffer: jest.fn(() => ({ buffer: true })),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    getExtension: jest.fn(() => null),
  };
}

function webgpu() {
  return {
    createBuffer: jest.fn((desc) => ({ desc })),
    queue: { writeBuffer: jest.fn() },
  };
}

describe('glTF parser/data split', () => {
  beforeEach(() => {
    global.GPUBufferUsage = { VERTEX: 0x20, INDEX: 0x10, COPY_DST: 0x08 };
  });

  test('retains backend-neutral primitive/material data and produces a valid RayScene', async () => {
    const asset = await parseGltfAsset(singleTriangleFiles());
    expect(asset.sourceName).toBe('triangle');
    expect([...asset.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...asset.indices]).toEqual([0, 1, 2]);
    expect(asset.material).toMatchObject({
      baseColor: [0.2, 0.4, 0.6, 1], emissive: [0.01, 0.02, 0.03], metallic: 0.1, roughness: 0.7,
    });
    expect(asset.rasterPrimitives).toHaveLength(1);
    expect(asset.rasterPrimitives[0].positions).toBe(asset.positions);
    expect(assetToRayScene(asset)).toBe(asset.rayScene);
    expect(validateRayScene(asset.rayScene)).toEqual({ ok: true, errors: [] });
    expect(asset.rayScene.geometries).toHaveLength(1);
    expect(asset.rayScene.instances).toHaveLength(1);
  });

  test('expands the selected static scene while sharing instanced local geometry', async () => {
    const asset = await parseGltfAsset(instancedSceneFiles());

    expect(asset.defaultSceneIndex).toBe(1);
    expect(asset.scenes).toEqual([{ rootNodeIndices: [2] }, { rootNodeIndices: [0] }]);
    expect(asset.nodes.map((node) => node.sourceNodeIndex)).toEqual([0, 1]);
    expect(asset.meshes[1].primitives).toEqual([]); // The unselected scene is not traversed.
    expect(asset.materials).toHaveLength(2);
    expect(asset.rasterPrimitives).toHaveLength(4);
    expect(assetToRasterPrimitives(asset)).toBe(asset.rasterPrimitives);

    const [parentFirst, parentSecond, childFirst, childSecond] = asset.rasterPrimitives;
    expect(parentFirst.positions).toBe(childFirst.positions);
    expect(parentSecond.positions).toBe(childSecond.positions);
    expect(parentFirst.positions).not.toBe(parentSecond.positions);
    expect(parentFirst.materialIndex).toBe(0);
    expect(parentSecond.materialIndex).toBe(1);
    expect(transformPoint(parentFirst.worldMatrix, [0, 0, 0])).toEqual([10, 0, 0]);
    const childOrigin = transformPoint(childFirst.worldMatrix, [0, 0, 0]);
    expect(childOrigin[0]).toBeCloseTo(10);
    expect(childOrigin[1]).toBeCloseTo(2);
    expect(childOrigin[2]).toBeCloseTo(0);

    expect(validateRayScene(asset.rayScene)).toEqual({ ok: true, errors: [] });
    expect(asset.rayScene.geometries).toHaveLength(2);
    expect(asset.rayScene.instances.map((instance) => instance.geometryIndex)).toEqual([0, 1, 0, 1]);
    expect(asset.rayScene.instances.map((instance) => instance.materialIndex)).toEqual([0, 1, 0, 1]);
    expect(asset.bounds.center[0]).toBeCloseTo(8.5);
    expect(asset.bounds.center[1]).toBeCloseTo(2);
    expect(asset.bounds.center[2]).toBeCloseTo(2);
  });

  test('rejects unsupported modes only when their scene is selected', async () => {
    await expect(parseGltfAsset(instancedSceneFiles({ selectUnsupportedScene: true })))
      .rejects.toThrow(/unsupported mode 1.*TRIANGLES/);
  });

  test('detects cycles in the selected node graph', async () => {
    await expect(parseGltfAsset(instancedSceneFiles({ cycle: true })))
      .rejects.toThrow(/Cycle detected.*node 0/);
  });

  test('decodes strided and normalized attributes across multiple buffers with uint32 indices', async () => {
    const asset = await parseGltfAsset(robustAccessorFiles());
    expect([...asset.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...asset.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...asset.texCoords]).toEqual([0, 0, 1, 0, 0, 1]);
    expect(asset.indices).toBeInstanceOf(Uint32Array);
    expect([...asset.indices]).toEqual([0, 1, 2]);
    expect(validateRayScene(asset.rayScene).ok).toBe(true);

    const drawable = await parseGltfForBackend({ device: webgpu() }, robustAccessorFiles());
    expect(drawable.indexFormat).toBe('uint32');
  });

  test('generates sequential indices and smooth normals when omitted', async () => {
    const files = missingGeometryDataFiles();
    const asset = await parseGltfAsset(files);
    expect(asset.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(asset.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
    expect(validateRayScene(asset.rayScene).ok).toBe(true);
  });

  test('parses a GLB v2 scene with an embedded BIN chunk', async () => {
    const asset = await parseGltfAsset(makeTriangleGlb());
    expect(asset.indices).toBeInstanceOf(Uint32Array);
    expect([...asset.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(validateRayScene(asset.rayScene).ok).toBe(true);
  });

  test('surfaces malformed GLB validation errors through the asset parser', async () => {
    const glb = makeTriangleGlb();
    new DataView(glb).setUint32(8, glb.byteLength - 4, true);
    await expect(parseGltfAsset(glb)).rejects.toThrow(/Malformed GLB.*declared length/);

    const badMagic = makeTriangleGlb();
    new DataView(badMagic).setUint32(0, 0, true);
    await expect(parseGltfAsset(new Map([['broken.glb', file(badMagic)]])))
      .rejects.toThrow(/Malformed GLB.*invalid magic/);
  });

  test.each([
    ['sparse', /sparse accessor/],
    ['draco', /KHR_draco_mesh_compression/],
    ['meshopt', /EXT_meshopt_compression/],
    ['skin', /unsupported skinning/],
    ['morph', /morph targets/],
    ['alpha', /unsupported alpha mode BLEND/],
  ])('rejects unsupported %s data with a feature-specific error', async (feature, expected) => {
    await expect(parseGltfAsset(deferredFeatureFiles(feature))).rejects.toThrow(expected);
  });

  test('uploads the same retained asset contract to WebGL', async () => {
    const gl = webgl();
    const drawable = await parseGltfForBackend({ gl }, singleTriangleFiles());
    expect(drawable.vertexCount).toBe(3);
    expect(drawable.indexType).toBe(WebGLRenderingContext.UNSIGNED_SHORT);
    expect(gl.bufferData).toHaveBeenCalledTimes(4);
    expect(drawable.rayTracing.preparedRayScene).toBe(drawable.rayTracing.asset.rayScene);
    expect(drawable._debug).toMatchObject({ positionElementCount: 9, indexElementCount: 3 });
  });

  test('uploads equivalent WebGPU buffers and preserves the ray sidecar', async () => {
    const device = webgpu();
    const drawable = await parseGltfForBackend({ device }, singleTriangleFiles());
    expect(drawable).toMatchObject({ kind: 'mesh', vertexCount: 3, indexFormat: 'uint16' });
    expect(device.createBuffer).toHaveBeenCalledTimes(4);
    expect(device.createBuffer.mock.calls[3][0].size).toBe(8); // WebGPU buffer sizes are 4-byte aligned.
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(4);
    expect(validateRayScene(drawable.rayTracing.preparedRayScene).ok).toBe(true);
  });

  test('uploads every raster instance while sharing repeated primitive GPU buffers', async () => {
    const device = webgpu();
    const drawable = await parseGltfForBackend({ device }, instancedSceneFiles());
    expect(drawable.primitives).toHaveLength(4);
    expect(drawable.vertexCount).toBe(12);
    expect(drawable.primitives[0].buffers).toBe(drawable.primitives[2].buffers);
    expect(drawable.primitives[1].buffers).toBe(drawable.primitives[3].buffers);
    expect(drawable.primitives[0].buffers).not.toBe(drawable.primitives[1].buffers);
    expect(drawable.primitives.map((primitive) => primitive.material.baseColor)).toEqual([
      [1, 0, 0, 1], [0, 0, 1, 1], [1, 0, 0, 1], [0, 0, 1, 1],
    ]);
    expect(device.createBuffer).toHaveBeenCalledTimes(8); // Two local geometries, four buffers each.
    expect(drawable.rayTracing).toMatchObject({ geometryRevision: 0, instanceRevision: 0 });
  });

  test('rejects an engine without a supported upload context after parsing', async () => {
    await expect(parseGltfForBackend({}, singleTriangleFiles())).rejects.toThrow(/Unsupported engine context/);
  });
});
