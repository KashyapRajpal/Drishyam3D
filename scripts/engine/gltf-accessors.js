/** glTF 2.0 accessor decoding without renderer or browser dependencies. */

const COMPONENTS_BY_TYPE = Object.freeze({
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
});

const COMPONENT_INFO = Object.freeze({
    5120: { bytes: 1, ArrayType: Int8Array, read: (view, offset) => view.getInt8(offset), signedMax: 127 },
    5121: { bytes: 1, ArrayType: Uint8Array, read: (view, offset) => view.getUint8(offset), unsignedMax: 255 },
    5122: { bytes: 2, ArrayType: Int16Array, read: (view, offset) => view.getInt16(offset, true), signedMax: 32767 },
    5123: { bytes: 2, ArrayType: Uint16Array, read: (view, offset) => view.getUint16(offset, true), unsignedMax: 65535 },
    5125: { bytes: 4, ArrayType: Uint32Array, read: (view, offset) => view.getUint32(offset, true), unsignedMax: 4294967295 },
    5126: { bytes: 4, ArrayType: Float32Array, read: (view, offset) => view.getFloat32(offset, true) },
});

function normalizeInteger(value, info) {
    if (info.signedMax) return Math.max(value / info.signedMax, -1);
    return value / info.unsignedMax;
}

/**
 * Decodes one accessor into a tightly packed typed array.
 * DataView reads make byte-strided and otherwise misaligned sources safe.
 */
export function decodeGltfAccessor(gltf, buffers, accessorIndex, label = `Accessor ${accessorIndex}`) {
    const accessor = gltf.accessors?.[accessorIndex];
    if (!accessor) throw new Error(`${label} references missing accessor ${accessorIndex}.`);
    if (accessor.sparse) throw new Error(`${label} uses a sparse accessor, which is not supported.`);
    if (!Number.isInteger(accessor.count) || accessor.count < 0) throw new Error(`${label} count must be a non-negative integer.`);
    const componentCount = COMPONENTS_BY_TYPE[accessor.type];
    if (!componentCount) throw new Error(`${label} uses unsupported accessor type ${accessor.type}.`);
    const component = COMPONENT_INFO[accessor.componentType];
    if (!component) throw new Error(`${label} uses unsupported component type ${accessor.componentType}.`);
    if (accessor.normalized && accessor.componentType === 5126) {
        throw new Error(`${label} cannot normalize floating-point components.`);
    }
    const bufferView = gltf.bufferViews?.[accessor.bufferView];
    if (!bufferView) throw new Error(`${label} references missing bufferView ${accessor.bufferView}.`);
    const bufferData = buffers?.[bufferView.buffer];
    if (!(bufferData instanceof ArrayBuffer)) throw new Error(`${label} references unloaded buffer ${bufferView.buffer}.`);

    const elementBytes = componentCount * component.bytes;
    const byteStride = bufferView.byteStride ?? elementBytes;
    if (!Number.isInteger(byteStride) || byteStride < elementBytes || byteStride % component.bytes !== 0) {
        throw new Error(`${label} has invalid byteStride ${byteStride}.`);
    }
    const viewStart = bufferView.byteOffset || 0;
    const viewLength = bufferView.byteLength;
    if (!Number.isInteger(viewStart) || viewStart < 0 || !Number.isInteger(viewLength) || viewLength < 0) {
        throw new Error(`${label} bufferView range is invalid.`);
    }
    const accessorOffset = accessor.byteOffset || 0;
    if (!Number.isInteger(accessorOffset) || accessorOffset < 0) throw new Error(`${label} byteOffset is invalid.`);
    const requiredBytes = accessor.count === 0 ? 0 : (accessor.count - 1) * byteStride + elementBytes;
    if (accessorOffset + requiredBytes > viewLength || viewStart + accessorOffset + requiredBytes > bufferData.byteLength) {
        throw new Error(`${label} reads beyond its bufferView.`);
    }

    const OutputType = accessor.normalized ? Float32Array : component.ArrayType;
    const output = new OutputType(accessor.count * componentCount);
    const view = new DataView(bufferData);
    const firstByte = viewStart + accessorOffset;
    for (let elementIndex = 0; elementIndex < accessor.count; elementIndex += 1) {
        const elementOffset = firstByte + elementIndex * byteStride;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            const value = component.read(view, elementOffset + componentIndex * component.bytes);
            output[elementIndex * componentCount + componentIndex] = accessor.normalized
                ? normalizeInteger(value, component)
                : value;
        }
    }
    return {
        data: output,
        count: accessor.count,
        componentCount,
        componentType: accessor.componentType,
        type: accessor.type,
        normalized: accessor.normalized === true,
    };
}

export function createSequentialIndices(vertexCount) {
    if (!Number.isInteger(vertexCount) || vertexCount < 0) throw new Error('Vertex count must be a non-negative integer.');
    const IndexType = vertexCount <= 65536 ? Uint16Array : Uint32Array;
    const indices = new IndexType(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) indices[index] = index;
    return indices;
}
