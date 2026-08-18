import { prepareRayScene } from './ray-scene.js';

function unitQuadGeometry() {
    return {
        id: 0,
        revision: 0,
        positions: new Float32Array([
            -0.5, -0.5, 0,
             0.5, -0.5, 0,
             0.5,  0.5, 0,
            -0.5,  0.5, 0,
        ]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        texCoords: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
}

function unitCubeGeometry() {
    const positions = [];
    const normals = [];
    const texCoords = [];
    const indices = [];
    const faces = [
        { n: [0, 0, 1],  p: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
        { n: [0, 0,-1],  p: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
        { n: [1, 0, 0],  p: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]] },
        { n: [-1,0, 0],  p: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]] },
        { n: [0, 1, 0],  p: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]] },
        { n: [0,-1, 0],  p: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] },
    ];
    for (const face of faces) {
        const base = positions.length / 3;
        for (let i = 0; i < 4; i += 1) {
            positions.push(face.p[i][0] * 0.5, face.p[i][1] * 0.5, face.p[i][2] * 0.5);
            normals.push(...face.n);
        }
        texCoords.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return {
        id: 1, revision: 0,
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        texCoords: new Float32Array(texCoords),
        indices: new Uint32Array(indices),
    };
}

function basisMatrix(center, xAxis, yAxis, zAxis) {
    return new Float32Array([
        xAxis[0], xAxis[1], xAxis[2], 0,
        yAxis[0], yAxis[1], yAxis[2], 0,
        zAxis[0], zAxis[1], zAxis[2], 0,
        center[0], center[1], center[2], 1,
    ]);
}

function boxMatrix(center, size, yawDegrees) {
    const angle = yawDegrees * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([
        c * size[0], 0, -s * size[0], 0,
        0, size[1], 0, 0,
        s * size[2], 0, c * size[2], 0,
        center[0], center[1], center[2], 1,
    ]);
}

export function createCornellBoxScene() {
    const materials = [
        { baseColor: [0.73, 0.73, 0.73, 1] },
        { baseColor: [0.65, 0.05, 0.05, 1] },
        { baseColor: [0.12, 0.45, 0.15, 1] },
        { baseColor: [1, 0.95, 0.8, 1], emissive: [1, 0.95, 0.8], emissiveStrength: 15 },
    ];
    const instances = [];
    const add = (geometryIndex, materialIndex, worldMatrix) => {
        instances.push({ id: instances.length, geometryIndex, materialIndex, worldMatrix });
    };

    // Shared unit quad instances. The first two columns span the plane; their
    // cross product matches the desired inward-facing normal in column three.
    add(0, 0, basisMatrix([0, 0, 0], [2,0,0], [0,0,-2], [0,1,0]));       // floor
    add(0, 0, basisMatrix([0, 2, 0], [2,0,0], [0,0,2], [0,-1,0]));       // ceiling
    add(0, 0, basisMatrix([0, 1,-1], [2,0,0], [0,2,0], [0,0,1]));       // back
    add(0, 1, basisMatrix([-1,1,0], [0,0,-2], [0,2,0], [1,0,0]));       // red left
    add(0, 2, basisMatrix([1, 1,0], [0,0,2], [0,2,0], [-1,0,0]));       // green right
    add(1, 0, boxMatrix([-0.38,0.3,0.1], [0.6,0.6,0.6], -18));
    add(1, 0, boxMatrix([0.35,0.6,-0.25], [0.55,1.2,0.55], 15));
    add(0, 3, basisMatrix([0,1.99,-0.2], [0.5,0,0], [0,0,0.4], [0,-1,0]));

    return prepareRayScene({
        geometries: [unitQuadGeometry(), unitCubeGeometry()],
        instances,
        materials,
        lights: [{
            type: 'rect',
            center: [0, 1.99, -0.2],
            u: [0.25, 0, 0],
            v: [0, 0, 0.2],
            color: [1, 0.95, 0.8],
            intensity: 15,
        }],
        camera: { eye: [0, 1, 3.2], target: [0, 1, 0], up: [0, 1, 0], fovY: 40 * Math.PI / 180 },
        environment: { color: [0, 0, 0] },
    });
}
