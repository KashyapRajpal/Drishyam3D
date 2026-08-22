export const DEFAULT_BVH_LEAF_SIZE = 4;
export const MAX_BVH_TRAVERSAL_DEPTH = 63;

function isFiniteVec3(value) {
    return value?.length === 3 && value.every(Number.isFinite);
}

function validateRecords(records) {
    if (!Array.isArray(records)) throw new Error('BVH records must be an array.');
    const ids = new Set();
    records.forEach((record, index) => {
        if (!Number.isInteger(record?.id) || record.id < 0) {
            throw new Error(`BVH record ${index} must have a non-negative integer id.`);
        }
        if (ids.has(record.id)) throw new Error(`BVH record id ${record.id} is duplicated.`);
        ids.add(record.id);
        if (!isFiniteVec3(record.min) || !isFiniteVec3(record.max) || !isFiniteVec3(record.centroid)) {
            throw new Error(`BVH record ${index} bounds and centroid must be finite vec3 values.`);
        }
        for (let axis = 0; axis < 3; axis += 1) {
            if (record.min[axis] > record.max[axis]) {
                throw new Error(`BVH record ${index} has inverted bounds on axis ${axis}.`);
            }
        }
    });
}

function rangeBounds(records, start, end, field) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i += 1) {
        const value = records[i][field];
        for (let axis = 0; axis < 3; axis += 1) {
            if (value[axis] < min[axis]) min[axis] = value[axis];
            if (value[axis] > max[axis]) max[axis] = value[axis];
        }
    }
    return { min, max };
}

function recordRangeBounds(records, start, end) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
            if (records[i].min[axis] < min[axis]) min[axis] = records[i].min[axis];
            if (records[i].max[axis] > max[axis]) max[axis] = records[i].max[axis];
        }
    }
    return { min, max };
}

function longestAxis(bounds) {
    const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
    if (extent[0] >= extent[1] && extent[0] >= extent[2]) return 0;
    return extent[1] >= extent[2] ? 1 : 2;
}

function emptyNode() {
    return { min: [0, 0, 0], leftFirst: 0, max: [0, 0, 0], primitiveCount: 0 };
}

/**
 * Builds the shared deterministic logical BVH used by both BLAS and TLAS.
 * Internal children are consecutive; the right child is always leftFirst + 1.
 */
export function buildMedianBvh(inputRecords, options = {}) {
    validateRecords(inputRecords);
    const leafSize = options.leafSize ?? DEFAULT_BVH_LEAF_SIZE;
    if (!Number.isInteger(leafSize) || leafSize < 1 || leafSize > DEFAULT_BVH_LEAF_SIZE) {
        throw new Error(`BVH leafSize must be an integer from 1 to ${DEFAULT_BVH_LEAF_SIZE}.`);
    }
    if (inputRecords.length === 0) {
        return {
            nodes: [],
            leafReferences: new Uint32Array(),
            maxDepth: 0,
            leafCount: 0,
            diagnostics: { stackCapacity: 64, stackSafe: true },
        };
    }

    const records = inputRecords.map((record, inputOrder) => ({ ...record, inputOrder }));
    const nodes = [emptyNode()];
    const leafReferences = [];
    let maxDepth = 0;
    let leafCount = 0;

    const fillNode = (nodeIndex, start, end, depth) => {
        maxDepth = Math.max(maxDepth, depth);
        const count = end - start;
        const bounds = recordRangeBounds(records, start, end);
        if (count <= leafSize) {
            const leftFirst = leafReferences.length;
            for (let i = start; i < end; i += 1) leafReferences.push(records[i].id);
            nodes[nodeIndex] = { min: bounds.min, leftFirst, max: bounds.max, primitiveCount: count };
            leafCount += 1;
            return;
        }

        const centroidBounds = rangeBounds(records, start, end, 'centroid');
        const axis = longestAxis(centroidBounds);
        const sorted = records.slice(start, end).sort((a, b) => (
            a.centroid[axis] - b.centroid[axis]
            || a.id - b.id
            || a.inputOrder - b.inputOrder
        ));
        records.splice(start, count, ...sorted);
        const middle = start + Math.floor(count / 2);
        const leftChild = nodes.length;
        // Reserve both children before recursing so rightChild === leftChild + 1.
        nodes.push(emptyNode(), emptyNode());
        nodes[nodeIndex] = { min: bounds.min, leftFirst: leftChild, max: bounds.max, primitiveCount: 0 };
        fillNode(leftChild, start, middle, depth + 1);
        fillNode(leftChild + 1, middle, end, depth + 1);
    };

    fillNode(0, 0, records.length, 0);
    const stackSafe = maxDepth <= MAX_BVH_TRAVERSAL_DEPTH;
    return {
        nodes,
        leafReferences: new Uint32Array(leafReferences),
        maxDepth,
        leafCount,
        diagnostics: { stackCapacity: 64, stackSafe },
    };
}
