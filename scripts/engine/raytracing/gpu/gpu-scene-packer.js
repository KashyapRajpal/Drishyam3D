import { determinant3x3 } from '../../matrix.js';
import {
    BVH_NODE_OFFSETS,
    BVH_NODE_SIZE,
    INSTANCE_FLAG_FLIPS_HANDEDNESS,
    INSTANCE_OFFSETS,
    INSTANCE_SIZE,
    INVALID_INDEX,
    MATERIAL_OFFSETS,
    MATERIAL_SIZE,
    TRIANGLE_OFFSETS,
    TRIANGLE_SIZE,
    U32_MAX,
    VERTEX_OFFSETS,
    VERTEX_SIZE,
} from './gpu-ray-layout.js';

const staticPackingSources = new WeakMap();

function checkedByteLength(count, stride, label) {
    if (!Number.isSafeInteger(count) || count < 0 || count > U32_MAX) throw new Error(`${label} count must fit u32.`);
    const bytes = count * stride;
    if (!Number.isSafeInteger(bytes)) throw new Error(`${label} byte length is unsafe.`);
    return bytes;
}

function requireU32(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) throw new Error(`${label} must fit u32.`);
    return value;
}

function requireFinite(value, label) {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
    return value;
}

function writeFloats(view, byteOffset, values, count, label) {
    if (!values || values.length < count) throw new Error(`${label} requires ${count} values.`);
    for (let index = 0; index < count; index += 1) {
        view.setFloat32(byteOffset + index * 4, requireFinite(values[index], `${label}[${index}]`), true);
    }
}

function validateInputs(scene, acceleration) {
    if (!scene || !Array.isArray(scene.geometries) || !Array.isArray(scene.instances) || !Array.isArray(scene.materials)) {
        throw new Error('GPU packing requires a prepared RayScene.');
    }
    if (!acceleration || !Array.isArray(acceleration.blases) || !acceleration.tlas) {
        throw new Error('GPU packing requires BLAS/TLAS acceleration structures.');
    }
    if (acceleration.blases.length !== scene.geometries.length) {
        throw new Error('GPU packing requires one BLAS per geometry.');
    }
}

function buildGeometryRanges(scene, acceleration) {
    let vertexOffset = 0;
    let triangleOffset = 0;
    let nodeOffset = acceleration.tlas.nodes.length;
    let leafOffset = acceleration.tlas.instanceIndices.length;
    return scene.geometries.map((geometry, geometryIndex) => {
        if (geometry.positions.length % 3 !== 0 || geometry.indices.length % 3 !== 0) {
            throw new Error(`Geometry ${geometryIndex} does not contain complete vertices/triangles.`);
        }
        const blas = acceleration.blases[geometryIndex];
        if (!blas || blas.geometryIndex !== geometryIndex) throw new Error(`BLAS ${geometryIndex} metadata is invalid.`);
        const range = {
            vertexOffset,
            vertexCount: geometry.positions.length / 3,
            triangleOffset,
            triangleCount: geometry.indices.length / 3,
            blasNodeOffset: blas.nodes.length ? nodeOffset : INVALID_INDEX,
            blasNodeCount: blas.nodes.length,
            blasLeafOffset: leafOffset,
            blasLeafCount: blas.triangleIndices.length,
        };
        vertexOffset += range.vertexCount;
        triangleOffset += range.triangleCount;
        nodeOffset += range.blasNodeCount;
        leafOffset += range.blasLeafCount;
        return range;
    });
}

function packVertices(scene, ranges, vertexCount) {
    const buffer = new ArrayBuffer(checkedByteLength(vertexCount, VERTEX_SIZE, 'vertex'));
    const view = new DataView(buffer);
    scene.geometries.forEach((geometry, geometryIndex) => {
        const range = ranges[geometryIndex];
        for (let localVertex = 0; localVertex < range.vertexCount; localVertex += 1) {
            const offset = (range.vertexOffset + localVertex) * VERTEX_SIZE;
            writeFloats(view, offset + VERTEX_OFFSETS.position, geometry.positions.subarray(localVertex * 3, localVertex * 3 + 3), 3, `Geometry ${geometryIndex} position`);
            writeFloats(view, offset + VERTEX_OFFSETS.normal, geometry.normals.subarray(localVertex * 3, localVertex * 3 + 3), 3, `Geometry ${geometryIndex} normal`);
            writeFloats(view, offset + VERTEX_OFFSETS.texCoord, geometry.texCoords.subarray(localVertex * 2, localVertex * 2 + 2), 2, `Geometry ${geometryIndex} texCoord`);
        }
    });
    return buffer;
}

function packTriangles(scene, ranges, triangleCount) {
    const buffer = new ArrayBuffer(checkedByteLength(triangleCount, TRIANGLE_SIZE, 'triangle'));
    const view = new DataView(buffer);
    scene.geometries.forEach((geometry, geometryIndex) => {
        const range = ranges[geometryIndex];
        for (let localTriangle = 0; localTriangle < range.triangleCount; localTriangle += 1) {
            const offset = (range.triangleOffset + localTriangle) * TRIANGLE_SIZE;
            for (let corner = 0; corner < 3; corner += 1) {
                const localIndex = requireU32(geometry.indices[localTriangle * 3 + corner], `Geometry ${geometryIndex} index`);
                if (localIndex >= range.vertexCount) throw new Error(`Geometry ${geometryIndex} index is out of range.`);
                view.setUint32(offset + TRIANGLE_OFFSETS.i0 + corner * 4, requireU32(range.vertexOffset + localIndex, 'global vertex index'), true);
            }
            view.setUint32(offset + TRIANGLE_OFFSETS.geometryIndex, geometryIndex, true);
        }
    });
    return buffer;
}

function writeNode(view, outputIndex, node, nodeBase, leafBase, localNodeCount, localLeafCount, label) {
    const offset = outputIndex * BVH_NODE_SIZE;
    writeFloats(view, offset + BVH_NODE_OFFSETS.min, node.min, 3, `${label} min`);
    writeFloats(view, offset + BVH_NODE_OFFSETS.max, node.max, 3, `${label} max`);
    const primitiveCount = requireU32(node.primitiveCount, `${label} primitiveCount`);
    const leftFirst = requireU32(node.leftFirst, `${label} leftFirst`);
    if (primitiveCount === 0) {
        if (leftFirst + 1 >= localNodeCount) throw new Error(`${label} child reference is out of range.`);
    } else if (primitiveCount > 4 || leftFirst + primitiveCount > localLeafCount) {
        throw new Error(`${label} leaf reference is out of range.`);
    }
    const adjustedLeftFirst = primitiveCount === 0 ? nodeBase + leftFirst : leafBase + leftFirst;
    view.setUint32(offset + BVH_NODE_OFFSETS.leftFirst, requireU32(adjustedLeftFirst, `${label} leftFirst`), true);
    view.setUint32(offset + BVH_NODE_OFFSETS.primitiveCount, primitiveCount, true);
}

function packTlas(scene, tlas) {
    const nodeBuffer = new ArrayBuffer(checkedByteLength(tlas.nodes.length, BVH_NODE_SIZE, 'TLAS node'));
    const leafBuffer = new ArrayBuffer(checkedByteLength(tlas.instanceIndices.length, 4, 'TLAS leaf reference'));
    const nodeView = new DataView(nodeBuffer);
    const leafView = new DataView(leafBuffer);
    tlas.nodes.forEach((node, index) => writeNode(
        nodeView,
        index,
        node,
        0,
        0,
        tlas.nodes.length,
        tlas.instanceIndices.length,
        `TLAS node ${index}`,
    ));
    tlas.instanceIndices.forEach((value, index) => {
        const instanceIndex = requireU32(value, 'TLAS instance reference');
        if (instanceIndex >= scene.instances.length) throw new Error(`TLAS instance reference ${instanceIndex} is out of range.`);
        leafView.setUint32(index * 4, instanceIndex, true);
    });
    return { nodeBuffer, leafBuffer };
}

function packNodesAndLeaves(scene, acceleration, ranges, nodeCount, leafCount) {
    const nodeBuffer = new ArrayBuffer(checkedByteLength(nodeCount, BVH_NODE_SIZE, 'BVH node'));
    const leafBuffer = new ArrayBuffer(checkedByteLength(leafCount, 4, 'BVH leaf reference'));
    const nodeView = new DataView(nodeBuffer);
    const leafView = new DataView(leafBuffer);
    const tlas = acceleration.tlas;
    const packedTlas = packTlas(scene, tlas);
    new Uint8Array(nodeBuffer).set(new Uint8Array(packedTlas.nodeBuffer));
    new Uint8Array(leafBuffer).set(new Uint8Array(packedTlas.leafBuffer));

    scene.geometries.forEach((_geometry, geometryIndex) => {
        const blas = acceleration.blases[geometryIndex];
        const range = ranges[geometryIndex];
        blas.nodes.forEach((node, localNode) => writeNode(
            nodeView,
            range.blasNodeOffset + localNode,
            node,
            range.blasNodeOffset,
            range.blasLeafOffset,
            blas.nodes.length,
            blas.triangleIndices.length,
            `BLAS ${geometryIndex} node ${localNode}`,
        ));
        blas.triangleIndices.forEach((value, localLeaf) => {
            const triangleIndex = requireU32(value, `BLAS ${geometryIndex} triangle reference`);
            if (triangleIndex >= range.triangleCount) throw new Error(`BLAS ${geometryIndex} triangle reference is out of range.`);
            leafView.setUint32(
                (range.blasLeafOffset + localLeaf) * 4,
                requireU32(range.triangleOffset + triangleIndex, 'global triangle reference'),
                true,
            );
        });
    });
    return { nodeBuffer, leafBuffer };
}

function packInstances(scene, ranges) {
    const buffer = new ArrayBuffer(checkedByteLength(scene.instances.length, INSTANCE_SIZE, 'instance'));
    const view = new DataView(buffer);
    scene.instances.forEach((instance, instanceIndex) => {
        if (!Number.isInteger(instance.geometryIndex) || !ranges[instance.geometryIndex]) {
            throw new Error(`Instance ${instanceIndex} geometry reference is invalid.`);
        }
        if (!Number.isInteger(instance.materialIndex) || !scene.materials[instance.materialIndex]) {
            throw new Error(`Instance ${instanceIndex} material reference is invalid.`);
        }
        const offset = instanceIndex * INSTANCE_SIZE;
        writeFloats(view, offset + INSTANCE_OFFSETS.worldMatrix, instance.worldMatrix, 16, `Instance ${instanceIndex} world matrix`);
        writeFloats(view, offset + INSTANCE_OFFSETS.inverseWorldMatrix, instance.inverseWorldMatrix, 16, `Instance ${instanceIndex} inverse matrix`);
        view.setUint32(offset + INSTANCE_OFFSETS.blasRoot, ranges[instance.geometryIndex].blasNodeOffset, true);
        view.setUint32(offset + INSTANCE_OFFSETS.geometryIndex, instance.geometryIndex, true);
        view.setUint32(offset + INSTANCE_OFFSETS.materialIndex, instance.materialIndex, true);
        const flags = determinant3x3(instance.worldMatrix) < 0 ? INSTANCE_FLAG_FLIPS_HANDEDNESS : 0;
        view.setUint32(offset + INSTANCE_OFFSETS.flags, flags, true);
    });
    return buffer;
}

function packMaterials(materials) {
    const buffer = new ArrayBuffer(checkedByteLength(materials.length, MATERIAL_SIZE, 'material'));
    const view = new DataView(buffer);
    materials.forEach((material, materialIndex) => {
        const offset = materialIndex * MATERIAL_SIZE;
        writeFloats(view, offset + MATERIAL_OFFSETS.baseColor, material.baseColor || [1, 1, 1, 1], 4, `Material ${materialIndex} base color`);
        writeFloats(view, offset + MATERIAL_OFFSETS.emissive, [
            ...(material.emissive || [0, 0, 0]).slice(0, 3),
            material.emissiveStrength ?? 0,
        ], 4, `Material ${materialIndex} emissive`);
        writeFloats(view, offset + MATERIAL_OFFSETS.surface, [
            material.metallic ?? 0,
            material.roughness ?? 1,
            material.alphaCutoff ?? 0.5,
            material.indexOfRefraction ?? 1.5,
        ], 4, `Material ${materialIndex} surface`);
        const textureIndex = Number.isInteger(material.baseColorImageIndex) && material.baseColorImageIndex >= 0
            ? requireU32(material.baseColorImageIndex, `Material ${materialIndex} texture index`)
            : INVALID_INDEX;
        view.setUint32(offset + MATERIAL_OFFSETS.textureIndex, textureIndex, true);
        view.setUint32(offset + MATERIAL_OFFSETS.flags, requireU32(material.flags ?? 0, `Material ${materialIndex} flags`), true);
    });
    return buffer;
}

export function packGpuScene(scene, acceleration) {
    validateInputs(scene, acceleration);
    const geometryRanges = buildGeometryRanges(scene, acceleration);
    const vertexCount = geometryRanges.reduce((sum, range) => sum + range.vertexCount, 0);
    const triangleCount = geometryRanges.reduce((sum, range) => sum + range.triangleCount, 0);
    const tlasNodeCount = acceleration.tlas.nodes.length;
    const tlasLeafCount = acceleration.tlas.instanceIndices.length;
    const nodeCount = tlasNodeCount + acceleration.blases.reduce((sum, blas) => sum + blas.nodes.length, 0);
    const leafCount = tlasLeafCount + acceleration.blases.reduce((sum, blas) => sum + blas.triangleIndices.length, 0);
    const { nodeBuffer, leafBuffer } = packNodesAndLeaves(scene, acceleration, geometryRanges, nodeCount, leafCount);
    const buffers = {
        vertices: packVertices(scene, geometryRanges, vertexCount),
        triangles: packTriangles(scene, geometryRanges, triangleCount),
        bvhNodes: nodeBuffer,
        bvhLeafReferences: leafBuffer,
        instances: packInstances(scene, geometryRanges),
        materials: packMaterials(scene.materials),
    };
    const logicalByteLengths = Object.fromEntries(Object.entries(buffers).map(([key, value]) => [key, value.byteLength]));
    const metadata = {
        vertexCount,
        triangleCount,
        nodeCount,
        leafCount,
        materialCount: scene.materials.length,
        instanceCount: scene.instances.length,
        tlasNodeCount,
        tlasLeafCount,
        blasNodeOffset: tlasNodeCount,
        blasLeafOffset: tlasLeafCount,
        geometryRanges,
        logicalByteLengths,
        allocationByteLengths: {
            vertices: Math.max(VERTEX_SIZE, buffers.vertices.byteLength),
            triangles: Math.max(TRIANGLE_SIZE, buffers.triangles.byteLength),
            bvhNodes: Math.max(BVH_NODE_SIZE, buffers.bvhNodes.byteLength),
            bvhLeafReferences: Math.max(4, buffers.bvhLeafReferences.byteLength),
            instances: Math.max(INSTANCE_SIZE, buffers.instances.byteLength),
            materials: Math.max(MATERIAL_SIZE, buffers.materials.byteLength),
        },
    };
    const packed = { buffers, metadata };
    staticPackingSources.set(packed, {
        geometries: [...scene.geometries],
        materials: [...scene.materials],
        blases: [...acceleration.blases],
    });
    return packed;
}

function copyPrefix(target, source, byteLength) {
    new Uint8Array(target, 0, byteLength).set(new Uint8Array(source, 0, byteLength));
}

/** Mutates only TLAS prefixes and the instance buffer; returns upload byte ranges. */
export function repackGpuTlasAndInstances(packed, scene, acceleration) {
    validateInputs(scene, acceleration);
    const currentMetadata = packed.metadata;
    const staticSources = staticPackingSources.get(packed);
    const staticInputsUnchanged = staticSources
        && staticSources.geometries.length === scene.geometries.length
        && staticSources.materials.length === scene.materials.length
        && staticSources.blases.length === acceleration.blases.length
        && staticSources.geometries.every((geometry, index) => geometry === scene.geometries[index])
        && staticSources.materials.every((material, index) => material === scene.materials[index])
        && staticSources.blases.every((blas, index) => blas === acceleration.blases[index]);
    if (!staticInputsUnchanged) {
        throw new Error('TLAS prefix repack requires unchanged geometry, materials, and BLAS objects.');
    }
    if (scene.instances.length !== currentMetadata.instanceCount
        || acceleration.tlas.nodes.length !== currentMetadata.tlasNodeCount
        || acceleration.tlas.instanceIndices.length !== currentMetadata.tlasLeafCount) {
        throw new Error('TLAS prefix repack requires stable instance, node, and leaf counts.');
    }
    const nextTlas = packTlas(scene, acceleration.tlas);
    const nextInstances = packInstances(scene, currentMetadata.geometryRanges);
    const nodeByteLength = nextTlas.nodeBuffer.byteLength;
    const leafByteLength = nextTlas.leafBuffer.byteLength;
    copyPrefix(packed.buffers.bvhNodes, nextTlas.nodeBuffer, nodeByteLength);
    copyPrefix(packed.buffers.bvhLeafReferences, nextTlas.leafBuffer, leafByteLength);
    new Uint8Array(packed.buffers.instances).set(new Uint8Array(nextInstances));
    return {
        nodeByteLength,
        leafByteLength,
        instanceByteLength: nextInstances.byteLength,
    };
}
