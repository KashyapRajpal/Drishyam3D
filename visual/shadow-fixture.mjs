function cubePositions() {
    const x = 0.45;
    const y0 = 0;
    const y1 = 1.3;
    const z = 0.45;
    const faces = [
        [[-x,y0,z],[x,y0,z],[x,y1,z],[-x,y1,z]],
        [[x,y0,-z],[-x,y0,-z],[-x,y1,-z],[x,y1,-z]],
        [[x,y0,z],[x,y0,-z],[x,y1,-z],[x,y1,z]],
        [[-x,y0,-z],[-x,y0,z],[-x,y1,z],[-x,y1,-z]],
        [[-x,y1,z],[x,y1,z],[x,y1,-z],[-x,y1,-z]],
        [[-x,y0,-z],[x,y0,-z],[x,y0,z],[-x,y0,z]],
    ];
    return new Float32Array(faces.flat(2));
}

function cubeIndices() {
    const values = [];
    for (let face = 0; face < 6; face += 1) {
        const base = face * 4;
        values.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return new Uint16Array(values);
}

function bytes(view) {
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

/** Deterministic, generated glTF receiver + occluder; no external asset license. */
export function createShadowFixture() {
    const planePositions = new Float32Array([
        -2, 0, -2,
         2, 0, -2,
         2, 0,  2,
        -2, 0,  2,
    ]);
    const planeIndices = new Uint16Array([0, 2, 1, 0, 3, 2]);
    const boxPositions = cubePositions();
    const boxIndices = cubeIndices();
    const chunks = [planePositions, planeIndices, boxPositions, boxIndices];
    const offsets = [];
    let byteOffset = 0;
    for (const chunk of chunks) {
        offsets.push(byteOffset);
        byteOffset += chunk.byteLength;
    }
    const binary = Buffer.concat(chunks.map(bytes));

    const gltf = {
        asset: { version: '2.0', generator: 'Drishyam3D ray release harness' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Shadow fixture', mesh: 0 }],
        meshes: [{
            name: 'Ground and occluder',
            primitives: [
                { attributes: { POSITION: 0 }, indices: 1, material: 0 },
                { attributes: { POSITION: 2 }, indices: 3, material: 1 },
            ],
        }],
        materials: [
            { name: 'Ground', pbrMetallicRoughness: { baseColorFactor: [0.68, 0.72, 0.78, 1] } },
            { name: 'Occluder', pbrMetallicRoughness: { baseColorFactor: [0.82, 0.32, 0.12, 1] } },
        ],
        buffers: [{ uri: 'shadow-fixture.bin', byteLength: binary.byteLength }],
        bufferViews: chunks.map((chunk, index) => ({
            buffer: 0,
            byteOffset: offsets[index],
            byteLength: chunk.byteLength,
            target: index % 2 === 0 ? 34962 : 34963,
        })),
        accessors: [
            { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-2, 0, -2], max: [2, 0, 2] },
            { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
            { bufferView: 2, componentType: 5126, count: 24, type: 'VEC3', min: [-0.45, 0, -0.45], max: [0.45, 1.3, 0.45] },
            { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
        ],
    };
    return { json: JSON.stringify(gltf), binary };
}
