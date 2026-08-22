import { Camera } from './camera.js';
import { buildAccelerationStructures } from './raytracing/acceleration/acceleration-structure.js';
import { createCameraFrame } from './raytracing/core/camera-rays.js';
import { createCornellBoxScene } from './raytracing/core/cornell-box.js';
import { createCpuRayController } from './raytracing/cpu/cpu-ray-controller.js';

const DEFAULT_SETTINGS = Object.freeze({
    maxBounces: 4,
    samplesPerFrame: 1,
    seed: 0x12345678,
    tileSize: 32,
    resolutionScale: 0.5,
    maxDimension: 512,
});

function canvasDisplaySize(canvas, settings) {
    const host = canvas.parentElement;
    const cssWidth = canvas.clientWidth || host?.clientWidth || canvas.width || 640;
    const cssHeight = canvas.clientHeight || host?.clientHeight || canvas.height || 480;
    let width = Math.max(1, Math.round(cssWidth * settings.resolutionScale));
    let height = Math.max(1, Math.round(cssHeight * settings.resolutionScale));
    const largest = Math.max(width, height);
    if (largest > settings.maxDimension) {
        const scale = settings.maxDimension / largest;
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
    }
    return { width, height };
}

function cameraPoseFromScene(camera, sceneCamera) {
    if (!sceneCamera) return;
    const delta = sceneCamera.eye.map((value, axis) => value - sceneCamera.target[axis]);
    const zoom = Math.hypot(...delta);
    camera.target = [...sceneCamera.target];
    camera.up = [...sceneCamera.up];
    camera.minZoom = Math.max(0.1, zoom * 0.1);
    camera.maxZoom = Math.max(20, zoom * 10);
    camera.setPose(Math.asin(delta[1] / zoom), Math.atan2(delta[0], delta[2]), zoom);
}

function makeImageData(context, rgba, width, height) {
    if (typeof ImageData !== 'undefined') return new ImageData(rgba, width, height);
    const image = context.createImageData(width, height);
    image.data.set(rgba);
    return image;
}

export async function initCpuRayEngine({
    canvas,
    onError,
    onStats,
    workerFactory,
    controllerFactory = createCpuRayController,
    settings: initialSettings,
} = {}) {
    if (!canvas) throw new Error('CPU ray engine requires a canvas.');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Unable to initialize a 2D canvas for CPU ray tracing.');
    if (typeof workerFactory !== 'function') {
        throw new Error('CPU ray engine requires a workerFactory supplied by the browser entry point.');
    }

    let destroyed = false;
    let active = false;
    let scene = null;
    let acceleration = null;
    let settings = { ...DEFAULT_SETTINGS, ...initialSettings };
    let dimensions = { width: 0, height: 0 };
    let latestStats = {
        backend: 'cpu', renderMode: 'raytrace-cpu', drawableKind: 'none',
        spp: 0, raysPerSecond: 0, frameMs: 0, triangleCount: 0, instanceCount: 0,
    };
    const camera = new Camera(canvas, [0, 1, 3.2]);

    const controller = controllerFactory({
        workerFactory,
        presentTile(message) {
            if (destroyed) return;
            const rgba = new Uint8ClampedArray(message.rgbaBuffer);
            context.putImageData(makeImageData(context, rgba, message.width, message.height), message.x, message.y);
        },
        onStats(stats) {
            latestStats = { ...latestStats, ...stats };
            onStats?.({ ...latestStats });
        },
        onError,
    });

    function renderRequest() {
        dimensions = canvasDisplaySize(canvas, settings);
        if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
        if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
        camera.updateViewMatrix();
        return {
            ...dimensions,
            tileSize: settings.tileSize,
            cameraFrame: createCameraFrame({
                eye: camera.getPosition(),
                target: camera.target,
                up: camera.up,
                fovY: scene?.camera?.fovY || 40 * Math.PI / 180,
                aspect: dimensions.width / dimensions.height,
            }),
        };
    }

    function resetAccumulation() {
        if (!scene || destroyed) return;
        controller.reset(renderRequest());
    }

    function resetForViewChange() {
        if (!active) return;
        resetAccumulation();
    }
    camera.setChangeHandler(resetForViewChange);

    function loadRayScene(preparedScene) {
        if (destroyed) throw new Error('CPU ray engine has been destroyed.');
        scene = preparedScene;
        acceleration = buildAccelerationStructures(scene);
        camera.setChangeHandler(null);
        cameraPoseFromScene(camera, scene.camera);
        camera.setChangeHandler(resetForViewChange);
        const triangleCount = scene.instances.reduce((count, instance) => (
            count + scene.geometries[instance.geometryIndex].indices.length / 3
        ), 0);
        latestStats = {
            ...latestStats,
            drawableKind: 'cornell-box',
            triangleCount,
            instanceCount: scene.instances.length,
            blasBuildMs: acceleration.blasBuildMs,
            tlasBuildMs: acceleration.tlasBuildMs,
            spp: 0,
        };
        controller.initialize(scene, acceleration, settings);
        if (active) controller.render(renderRequest());
        return scene;
    }

    return {
        camera,
        loadRayScene,
        loadCornellBox: () => loadRayScene(createCornellBoxScene()),
        setSettings(partial = {}) {
            settings = { ...settings, ...partial };
            if (scene) {
                controller.initialize(scene, acceleration, settings);
                if (active) controller.render(renderRequest());
            }
        },
        resetAccumulation,
        resize() {
            if (!scene || !active) return;
            const next = canvasDisplaySize(canvas, settings);
            if (next.width !== dimensions.width || next.height !== dimensions.height) {
                controller.reset(renderRequest());
            }
        },
        pause() {
            active = false;
            controller.pause();
        },
        resume() {
            if (destroyed || active || !scene) return;
            active = true;
            controller.render(renderRequest());
        },
        getCameraState: () => camera.getState(),
        setCameraState: (state) => camera.setState(state),
        getStats: () => ({ ...latestStats, ...controller.getStats() }),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            active = false;
            controller.destroy();
            camera.destroy();
            scene = null;
            acceleration = null;
        },
    };
}
