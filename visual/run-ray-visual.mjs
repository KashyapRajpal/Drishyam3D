/**
 * Self-contained browser release gate for CPU/GPU Cornell rendering and glTF
 * hybrid shadows. Procedural fixtures avoid the local/unlicensed asset required
 * by the splat visual suite.
 *
 * Prerequisite: `cd ui && npm run dev`
 *   npm run visual:ray
 *   npm run visual:ray:update
 */
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parityCases, rayVisualCases } from './ray-cases.mjs';
import { createShadowFixture } from './shadow-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = {
    baseUrl: 'http://localhost:5173/Drishyam3D',
    viewport: { width: 1000, height: 720 },
    headless: false,
    paritySize: 32,
    captureSize: 320,
    cpuCaptureSize: 160,
    parityRmse: 0.005,
    paritySsim: 0.995,
    threshold: 0.01,
    pixelThreshold: 0.1,
    timeoutMs: 60000,
    settleMs: 500,
};
const cfgPath = path.join(here, 'local.config.json');
const local = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const config = { ...defaults, ...(local.ray || {}) };
const update = process.argv.includes('--update');
const goldenDir = path.join(here, 'golden', 'ray');
const outputDir = path.join(here, 'output', 'ray');
fs.mkdirSync(goldenDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function errorMessage(error) {
    return error?.stack || error?.message || String(error);
}

function comparePng(name, currentBytes) {
    const outputPath = path.join(outputDir, `${name}.png`);
    const goldenPath = path.join(goldenDir, `${name}.png`);
    fs.writeFileSync(outputPath, currentBytes);
    if (update || !fs.existsSync(goldenPath)) {
        fs.writeFileSync(goldenPath, currentBytes);
        return { name, status: update ? 'updated' : 'created', difference: 0 };
    }
    const current = PNG.sync.read(currentBytes);
    const golden = PNG.sync.read(fs.readFileSync(goldenPath));
    if (current.width !== golden.width || current.height !== golden.height) {
        return {
            name,
            status: 'failed',
            reason: `size ${current.width}x${current.height} vs ${golden.width}x${golden.height}`,
        };
    }
    const diff = new PNG({ width: current.width, height: current.height });
    const mismatched = pixelmatch(
        golden.data,
        current.data,
        diff.data,
        current.width,
        current.height,
        { threshold: config.pixelThreshold },
    );
    const difference = mismatched / (current.width * current.height);
    fs.writeFileSync(path.join(outputDir, `${name}.diff.png`), PNG.sync.write(diff));
    return {
        name,
        status: difference <= config.threshold ? 'passed' : 'failed',
        difference,
        reason: difference > config.threshold
            ? `${(difference * 100).toFixed(3)}% pixels differ; limit ${(config.threshold * 100).toFixed(3)}%`
            : undefined,
    };
}

async function setCanvasSize(page, selector, size) {
    await page.$eval(selector, (canvas, nextSize) => {
        canvas.style.width = `${nextSize}px`;
        canvas.style.height = `${nextSize}px`;
        window.dispatchEvent(new Event('resize'));
    }, size);
    await page.waitForTimeout(100);
}

async function waitForSpp(page, mode, targetSpp) {
    await page.waitForFunction(
        ({ expectedMode, spp }) => {
            const api = window.__DRISHYAM_RAY_TEST;
            const stats = api?.getStats?.();
            return api?.getRenderMode?.() === expectedMode && (stats?.spp || 0) >= spp;
        },
        { expectedMode: mode, spp: targetSpp },
        { timeout: config.timeoutMs },
    );
}

async function capture(page, name, selector) {
    const canvas = await page.$(selector);
    if (!canvas) throw new Error(`Missing capture canvas: ${selector}`);
    return comparePng(name, await canvas.screenshot());
}

let browser;
const fixture = createShadowFixture();
const visualResults = [];
const parityResults = [];
const resetResult = {};
const browserErrors = [];
let hardware = {};

try {
    browser = await chromium.launch({ channel: 'chrome', headless: config.headless });
    const page = await browser.newPage({ viewport: config.viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => browserErrors.push(errorMessage(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
    });
    await page.route('**/__ray_fixture/shadow-fixture.gltf', (route) => route.fulfill({
        status: 200,
        contentType: 'model/gltf+json',
        body: fixture.json,
    }));
    await page.route('**/__ray_fixture/shadow-fixture.bin', (route) => route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: fixture.binary,
    }));

    await page.goto(`${config.baseUrl}/?test=1`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
        () => !!window.__DRISHYAM_ENGINE && !!window.__DRISHYAM_RAY_TEST,
        null,
        { timeout: 30000 },
    );
    await page.waitForTimeout(config.settleMs);

    hardware = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter?.();
        const info = adapter?.info || await adapter?.requestAdapterInfo?.().catch(() => null);
        return {
            userAgent: navigator.userAgent,
            adapter: info ? {
                vendor: info.vendor,
                architecture: info.architecture,
                device: info.device,
                description: info.description,
            } : null,
            capabilities: window.__DRISHYAM_RAY_TEST.getCapabilities(),
        };
    });

    // Exercise the real worker-backed CPU presentation and preserve a snapshot.
    await page.evaluate(() => window.__DRISHYAM_RAY_TEST.loadCornell('raytrace-cpu'));
    await page.waitForFunction(() => document.querySelector('#cpu-ray-canvas')?.getAttribute('aria-hidden') === 'false');
    await setCanvasSize(page, '#cpu-ray-canvas', config.cpuCaptureSize);
    await page.evaluate(({ maxDimension }) => {
        window.__DRISHYAM_RAY_TEST.setRayTracingSettings({
            seed: 0x12345678,
            maxBounces: 4,
            samplesPerFrame: 4,
            resolutionScale: 1,
            maxDimension,
        });
    }, { maxDimension: config.cpuCaptureSize });
    await waitForSpp(page, 'raytrace-cpu', 8);
    await page.evaluate(() => window.__DRISHYAM_RAY_TEST.pause());
    visualResults.push(await capture(page, 'cornell-cpu', '#cpu-ray-canvas'));

    // Numerically compare real rgba16float GPU output with the CPU oracle.
    for (const parityCase of parityCases) {
        await setCanvasSize(page, '#glcanvas', config.paritySize);
        await page.evaluate(async ({ settings }) => {
            const api = window.__DRISHYAM_RAY_TEST;
            if (api.getRenderMode() !== 'raytrace-gpu') await api.loadCornell('raytrace-gpu');
            api.setRayTracingSettings(settings);
            api.resetAccumulation();
            api.resume();
        }, parityCase);
        await waitForSpp(page, 'raytrace-gpu', parityCase.targetSpp);
        await page.evaluate(() => window.__DRISHYAM_RAY_TEST.pause());
        const comparison = await page.evaluate(
            ({ settings }) => window.__DRISHYAM_RAY_TEST.compareGpuCornellReference(settings),
            parityCase,
        );
        const diagnostics = await page.evaluate(() => window.__DRISHYAM_RAY_TEST.readRayDiagnostics());
        const passed = comparison.rmse <= config.parityRmse
            && comparison.ssim >= config.paritySsim
            && diagnostics.stackOverflows === 0
            && diagnostics.nonFinite === 0;
        parityResults.push({ name: parityCase.name, ...comparison, diagnostics, passed });

        await setCanvasSize(page, '#glcanvas', config.captureSize);
        await page.evaluate(() => {
            const api = window.__DRISHYAM_RAY_TEST;
            api.resetAccumulation();
            api.resume();
        });
        await waitForSpp(page, 'raytrace-gpu', parityCase.targetSpp);
        await page.evaluate(() => window.__DRISHYAM_RAY_TEST.pause());
        visualResults.push(await capture(page, parityCase.name, '#glcanvas'));
    }

    // A reset must synchronously clear SPP, then converge from a moved camera.
    resetResult.beforeSpp = await page.evaluate(() => window.__DRISHYAM_RAY_TEST.getStats().spp);
    resetResult.afterResetSpp = await page.evaluate(() => {
        const engine = window.__DRISHYAM_ENGINE;
        const api = window.__DRISHYAM_RAY_TEST;
        const state = engine.camera.getState();
        engine.camera.setPose(state.rotationX, state.rotationY + 0.18, state.zoom);
        api.resetAccumulation();
        return api.getStats().spp;
    });
    if (resetResult.afterResetSpp !== 0) {
        throw new Error(`Accumulation reset reported ${resetResult.afterResetSpp} spp instead of 0.`);
    }
    await page.evaluate(() => window.__DRISHYAM_RAY_TEST.resume());
    await waitForSpp(page, 'raytrace-gpu', 16);
    await page.evaluate(() => window.__DRISHYAM_RAY_TEST.pause());
    resetResult.afterResumeSpp = await page.evaluate(() => window.__DRISHYAM_RAY_TEST.getStats().spp);
    visualResults.push(await capture(page, 'cornell-accumulation-reset', '#glcanvas'));

    // Generated glTF validates the production parser/upload/BLAS/TLAS/hybrid path.
    await setCanvasSize(page, '#glcanvas', config.captureSize);
    const fixtureLoad = await page.evaluate(async () => {
        const engine = window.__DRISHYAM_ENGINE;
        const scriptFrozen = engine.setScriptSource('function init() {}\nfunction update() {}');
        if (!scriptFrozen) throw new Error('Could not install the deterministic no-op scene script.');
        const [json, binary] = await Promise.all([
            fetch('/__ray_fixture/shadow-fixture.gltf').then((response) => response.blob()),
            fetch('/__ray_fixture/shadow-fixture.bin').then((response) => response.blob()),
        ]);
        const files = [
            new File([json], 'shadow-fixture.gltf', { type: 'model/gltf+json' }),
            new File([binary], 'shadow-fixture.bin', { type: 'application/octet-stream' }),
        ];
        const api = window.__DRISHYAM_RAY_TEST;
        const loaded = await api.loadFiles(files);
        engine.camera.target = [0, 0.55, 0];
        engine.camera.minZoom = 0.1;
        engine.camera.maxZoom = 20;
        engine.camera.setPose(0.34, 0.55, 5.2);
        api.setLight({
            type: 'directional', direction: [-0.7, -1, -0.45],
            color: [1, 0.96, 0.9], intensity: 1.4, ambient: 0.12, exposure: 1,
        });
        await api.setRenderMode('hybrid-shadows');
        api.resume();
        return loaded;
    });
    if (!fixtureLoad.rayTraceable) throw new Error('Generated glTF did not retain a ray-tracing sidecar.');
    await page.waitForFunction(
        () => window.__DRISHYAM_RAY_TEST.getStats()?.renderMode === 'hybrid-shadows',
        null,
        { timeout: config.timeoutMs },
    );
    await page.waitForTimeout(config.settleMs);
    const hybridStats = await page.evaluate(() => window.__DRISHYAM_RAY_TEST.getStats());
    if (hybridStats.triangleCount !== 14 || hybridStats.instanceCount !== 2) {
        throw new Error(`Hybrid fixture packed ${hybridStats.triangleCount} triangles/${hybridStats.instanceCount} instances; expected 14/2.`);
    }
    await page.evaluate(() => window.__DRISHYAM_RAY_TEST.pause());
    visualResults.push(await capture(page, 'gltf-hybrid-shadow', '#glcanvas'));

    const missingCases = rayVisualCases.filter((name) => !visualResults.some((result) => result.name === name));
    if (missingCases.length) throw new Error(`Ray visual cases were not captured: ${missingCases.join(', ')}`);

    const report = {
        generatedAt: new Date().toISOString(),
        platform: { type: os.type(), release: os.release(), arch: os.arch() },
        browserVersion: browser.version(),
        hardware,
        config,
        parityResults,
        resetResult,
        hybridStats,
        visualResults,
        browserErrors,
    };
    fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

    console.log('\nRay tracing release gate\n');
    for (const result of parityResults) {
        console.log(
            `  ${result.passed ? 'PASS' : 'FAIL'} ${result.name}: `
            + `RMSE ${result.rmse.toFixed(5)} (<= ${config.parityRmse}), `
            + `SSIM ${result.ssim.toFixed(5)} (>= ${config.paritySsim}), ${result.spp} spp`,
        );
    }
    for (const result of visualResults) {
        const difference = result.difference == null ? '' : ` (${(result.difference * 100).toFixed(3)}% drift)`;
        console.log(`  ${result.status === 'failed' ? 'FAIL' : 'PASS'} ${result.name}: ${result.status}${difference}`);
    }
    console.log(`\n  Report: ${path.relative(process.cwd(), path.join(outputDir, 'report.json'))}`);

    const failed = parityResults.some((result) => !result.passed)
        || visualResults.some((result) => result.status === 'failed')
        || browserErrors.length > 0;
    if (failed) {
        if (browserErrors.length) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(`\nRay tracing release gate failed:\n${errorMessage(error)}`);
    process.exitCode = 1;
} finally {
    await browser?.close();
}
