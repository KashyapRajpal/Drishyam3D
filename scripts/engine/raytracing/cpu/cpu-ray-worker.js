import { generateCameraRay } from '../core/camera-rays.js';
import { createRng, nextFloat } from '../core/random.js';
import { linearRgbToRgba8, traceSample } from './path-integrator.js';

let generation = -1;
let renderToken = 0;
let destroyed = false;
let preparedScene = null;
let acceleration = null;
let settings = {};
let accumulation = new Float32Array();
let accumulationWidth = 0;
let accumulationHeight = 0;
let spp = 0;

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function post(message, transfer = []) {
    self.postMessage(message, transfer);
}

function resetAccumulation(width = 0, height = 0) {
    accumulationWidth = width;
    accumulationHeight = height;
    accumulation = new Float32Array(width * height * 3);
    spp = 0;
}

function sampleSeed(baseSeed, pixelIndex, sampleIndex) {
    let value = (baseSeed ^ Math.imul(pixelIndex + 1, 0x9e3779b1)
        ^ Math.imul(sampleIndex + 1, 0x85ebca6b)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
    return (value ^ (value >>> 16)) >>> 0;
}

function yieldToMessages() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderPass(message) {
    const { width, height, cameraFrame, passIndex } = message;
    const tileSize = message.tileSize || 32;
    if (![width, height, tileSize].every(Number.isInteger) || width < 1 || height < 1 || tileSize < 1) {
        throw new Error('CPU render dimensions and tile size must be positive integers.');
    }
    if (!preparedScene || !acceleration) throw new Error('CPU ray worker must be initialized before render.');
    if (width !== accumulationWidth || height !== accumulationHeight || passIndex === 0) {
        resetAccumulation(width, height);
    }

    const token = ++renderToken;
    const started = now();
    const samplesPerFrame = Math.max(1, settings.samplesPerFrame | 0);
    const nextSpp = spp + samplesPerFrame;
    const rayCounter = { count: 0 };
    const isCancelled = () => destroyed || token !== renderToken || message.generation !== generation;

    for (let tileY = 0; tileY < height; tileY += tileSize) {
        for (let tileX = 0; tileX < width; tileX += tileSize) {
            if (isCancelled()) return;
            const tileWidth = Math.min(tileSize, width - tileX);
            const tileHeight = Math.min(tileSize, height - tileY);
            const rgba = new Uint8ClampedArray(tileWidth * tileHeight * 4);
            for (let localY = 0; localY < tileHeight; localY += 1) {
                const y = tileY + localY;
                for (let localX = 0; localX < tileWidth; localX += 1) {
                    const x = tileX + localX;
                    const pixelIndex = y * width + x;
                    const accumulationOffset = pixelIndex * 3;
                    for (let batchSample = 0; batchSample < samplesPerFrame; batchSample += 1) {
                        const sampleIndex = spp + batchSample;
                        const rng = createRng(sampleSeed(settings.seed ?? 0x12345678, pixelIndex, sampleIndex));
                        const ray = generateCameraRay(
                            cameraFrame, x, y, width, height, [nextFloat(rng), nextFloat(rng)],
                        );
                        const color = traceSample(ray, preparedScene, acceleration, rng, {
                            maxBounces: settings.maxBounces,
                            shouldCancel: isCancelled,
                            rayCounter,
                        });
                        const denominator = sampleIndex + 1;
                        for (let channel = 0; channel < 3; channel += 1) {
                            accumulation[accumulationOffset + channel] = (
                                accumulation[accumulationOffset + channel] * sampleIndex + color[channel]
                            ) / denominator;
                        }
                    }
                    const tileOffset = (localY * tileWidth + localX) * 4;
                    linearRgbToRgba8([
                        accumulation[accumulationOffset],
                        accumulation[accumulationOffset + 1],
                        accumulation[accumulationOffset + 2],
                    ], rgba, tileOffset);
                }
            }
            if (isCancelled()) return;
            post({
                type: 'tile', generation, x: tileX, y: tileY,
                width: tileWidth, height: tileHeight, spp: nextSpp, rgbaBuffer: rgba.buffer,
            }, [rgba.buffer]);
            await yieldToMessages();
        }
    }
    if (isCancelled()) return;
    spp = nextSpp;
    post({
        type: 'pass-complete', generation, spp,
        elapsedMs: now() - started, rays: rayCounter.count,
    });
}

self.onmessage = (event) => {
    const message = event.data || {};
    try {
        if (message.type === 'init') {
            renderToken += 1;
            generation = message.generation;
            preparedScene = message.preparedScene;
            acceleration = message.acceleration;
            settings = { ...message.settings };
            resetAccumulation();
            post({ type: 'ready', generation });
        } else if (message.type === 'update-instances') {
            renderToken += 1;
            generation = message.generation;
            preparedScene = { ...preparedScene, instances: message.instances };
            acceleration = { ...acceleration, tlas: message.tlas };
            resetAccumulation();
            post({ type: 'ready', generation });
        } else if (message.type === 'render') {
            void renderPass(message).catch((error) => post({
                type: 'error', generation: message.generation,
                message: error?.message || String(error), stack: error?.stack,
            }));
        } else if (message.type === 'cancel') {
            renderToken += 1;
        } else if (message.type === 'destroy') {
            destroyed = true;
            renderToken += 1;
            preparedScene = null;
            acceleration = null;
            resetAccumulation();
            self.close?.();
        } else {
            throw new Error(`Unknown CPU ray worker message type: ${message.type}`);
        }
    } catch (error) {
        post({
            type: 'error', generation: message.generation,
            message: error?.message || String(error), stack: error?.stack,
        });
    }
};
