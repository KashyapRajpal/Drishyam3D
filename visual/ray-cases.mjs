export const parityCases = [
    {
        name: 'cornell-direct',
        settings: { seed: 0x12345678, maxBounces: 1, samplesPerFrame: 16, environmentIntensity: 1 },
        targetSpp: 32,
    },
    {
        name: 'cornell-multibounce',
        settings: { seed: 0x12345678, maxBounces: 4, samplesPerFrame: 16, environmentIntensity: 1 },
        targetSpp: 32,
    },
];

export const rayVisualCases = Object.freeze([
    'cornell-cpu',
    ...parityCases.map(({ name }) => name),
    'cornell-accumulation-reset',
    'gltf-hybrid-shadow',
]);
