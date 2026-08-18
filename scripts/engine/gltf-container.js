/** Pure glTF JSON / GLB v2 container parsing. */

export const GLB_MAGIC = 0x46546c67;
export const GLB_JSON_CHUNK = 0x4e4f534a;
export const GLB_BIN_CHUNK = 0x004e4942;

export function isGlb(arrayBuffer) {
    return arrayBuffer instanceof ArrayBuffer
        && arrayBuffer.byteLength >= 4
        && new DataView(arrayBuffer).getUint32(0, true) === GLB_MAGIC;
}

export function parseGlb(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) {
        throw new Error('Malformed GLB: header is truncated.');
    }
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Malformed GLB: invalid magic.');
    const version = view.getUint32(4, true);
    if (version !== 2) throw new Error(`Unsupported GLB version ${version}; expected version 2.`);
    const declaredLength = view.getUint32(8, true);
    if (declaredLength !== arrayBuffer.byteLength) {
        throw new Error(`Malformed GLB: declared length ${declaredLength} does not match ${arrayBuffer.byteLength}.`);
    }

    let offset = 12;
    let json = null;
    let binaryChunk = null;
    let chunkIndex = 0;
    while (offset < declaredLength) {
        if (offset + 8 > declaredLength) throw new Error(`Malformed GLB: chunk ${chunkIndex} header is truncated.`);
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        const dataEnd = dataStart + chunkLength;
        if (chunkLength % 4 !== 0) throw new Error(`Malformed GLB: chunk ${chunkIndex} length is not 4-byte aligned.`);
        if (dataEnd > declaredLength) throw new Error(`Malformed GLB: chunk ${chunkIndex} exceeds the declared length.`);

        if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) {
            throw new Error('Malformed GLB: the first chunk must be JSON.');
        }
        if (chunkType === GLB_JSON_CHUNK) {
            if (json) throw new Error('Malformed GLB: duplicate JSON chunk.');
            let jsonText = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer, dataStart, chunkLength));
            jsonText = jsonText.replace(/\u0000+$/u, '').trimEnd();
            try {
                json = JSON.parse(jsonText);
            } catch (error) {
                throw new Error(`Malformed GLB JSON chunk: ${error.message}`);
            }
        } else if (chunkType === GLB_BIN_CHUNK) {
            if (!json) throw new Error('Malformed GLB: BIN chunk appears before JSON.');
            if (binaryChunk) throw new Error('Malformed GLB: duplicate BIN chunk.');
            binaryChunk = arrayBuffer.slice(dataStart, dataEnd);
        } else {
            throw new Error(`Malformed GLB: unsupported chunk type 0x${chunkType.toString(16)}.`);
        }
        offset = dataEnd;
        chunkIndex += 1;
    }
    if (!json) throw new Error('Malformed GLB: JSON chunk is missing.');
    return { json, binaryChunk };
}

export function parseGltfContainer(arrayBuffer) {
    if (isGlb(arrayBuffer)) return parseGlb(arrayBuffer);
    try {
        return {
            json: JSON.parse(new TextDecoder('utf-8').decode(arrayBuffer)),
            binaryChunk: null,
        };
    } catch (error) {
        throw new Error(`Malformed glTF JSON: ${error.message}`);
    }
}
