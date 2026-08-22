import { loadAssetFiles } from '../scene-ops.js';
import { createCameraFrame } from './core/camera-rays.js';
import { createCornellBoxScene } from './core/cornell-box.js';
import { compareLinearRgba } from './core/image-metrics.js';
import { renderCpuReference } from './cpu/cpu-reference-renderer.js';

/**
 * Browser-only release-test surface. App.jsx imports this module dynamically
 * for ?test=1, so reference rendering and metric code stay out of normal loads.
 */
export function createRayVisualTestApi({ engine, coordinator }) {
    if (!engine || !coordinator) throw new Error('Ray visual tests require an engine and coordinator.');

    return {
        async loadCornell(mode) {
            const scene = await coordinator.loadCornellBox(mode);
            await coordinator.setRenderMode(mode);
            return {
                mode: coordinator.getRenderMode(),
                triangleCount: scene.instances.reduce((count, instance) => (
                    count + scene.geometries[instance.geometryIndex].indices.length / 3
                ), 0),
                instanceCount: scene.instances.length,
            };
        },

        async loadFiles(files) {
            await coordinator.setRenderMode('raster');
            const result = await loadAssetFiles({ engine, files });
            await coordinator.setSceneAsset(result.drawable?.rayTracing ? result.drawable : null);
            return {
                kind: result.kind,
                rayTraceable: !!result.drawable?.rayTracing,
            };
        },

        setRenderMode: (mode) => coordinator.setRenderMode(mode),
        setRayTracingSettings: (settings) => coordinator.setRayTracingSettings(settings),
        setLight: (light) => coordinator.setLight(light),
        resetAccumulation: () => coordinator.resetAccumulation(),
        pause: () => coordinator.pause(),
        resume: () => coordinator.resume(),
        getRenderMode: () => coordinator.getRenderMode(),
        getStats: () => coordinator.getStats(),
        getCapabilities: () => coordinator.getCapabilities(),
        readRayDiagnostics: () => engine.readRayDiagnostics(),

        async compareGpuCornellReference(settings = {}) {
            if (coordinator.getRenderMode() !== 'raytrace-gpu') {
                throw new Error('Cornell parity requires raytrace-gpu mode.');
            }
            const gpu = await engine.readRayAccumulation();
            const scene = createCornellBoxScene();
            engine.camera.updateViewMatrix();
            const cameraFrame = createCameraFrame({
                eye: engine.camera.getPosition(),
                target: engine.camera.target,
                up: engine.camera.up,
                fovY: scene.camera.fovY,
                aspect: gpu.width / gpu.height,
            });
            const cpu = renderCpuReference({
                scene,
                cameraFrame,
                width: gpu.width,
                height: gpu.height,
                settings: { ...settings, spp: gpu.spp },
            });
            return {
                width: gpu.width,
                height: gpu.height,
                spp: gpu.spp,
                ...compareLinearRgba(gpu.data, cpu.data),
            };
        },
    };
}
