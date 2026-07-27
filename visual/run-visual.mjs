/**
 * @file Local visual-regression runner for the WebGPU splat renderer.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 *
 * Drives the running Vite app in real Chrome (WebGPU) at deterministic camera
 * poses / SH degrees / reduction modes, screenshots the canvas, and compares
 * each frame against a golden PNG. Golden images and the test .ply live LOCALLY
 * and are gitignored — the assets are unlicensed and must not reach GitHub.
 *
 *   npm run visual           compare current renders against goldens (fails on drift)
 *   npm run visual:update    (re)write the goldens from the current renders
 *
 * Prereqs: the dev server running (`cd ui && npm run dev`) and Chrome installed.
 * Optional visual/local.config.json overrides the defaults below.
 */
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const defaults = {
    // The test capture is gitignored under assets/3dgs/ — override in local.config.json if needed.
    plyPath: 'assets/3dgs/source/3DGS.ply TRE.ply',
    // The Vite app is served under a base path (see ui/vite.config.js `base`).
    baseUrl: 'http://localhost:5173/Drishyam3D',
    threshold: 0.01,                    // max fraction of pixels allowed to differ per case
    pixelThreshold: 0.1,                // per-pixel colour tolerance (pixelmatch)
    viewport: { width: 800, height: 600 },
    headless: false,                    // headed Chrome is the most reliable WebGPU path
    settleMs: 1500,                     // wait after loading the splat
    frameMs: 400,                       // wait after changing pose/params
};

let config = { ...defaults };
const cfgPath = path.join(here, 'local.config.json');
if (fs.existsSync(cfgPath)) config = { ...config, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };

const update = process.argv.includes('--update');
const goldenDir = path.join(here, 'golden');
const outputDir = path.join(here, 'output');
fs.mkdirSync(goldenDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const plyAbs = path.isAbsolute(config.plyPath) ? config.plyPath : path.join(root, config.plyPath);
if (!fs.existsSync(plyAbs)) {
    console.error(`✗ Test .ply not found: ${plyAbs}\n  Set plyPath in visual/local.config.json.`);
    process.exit(2);
}
const plyBytes = fs.readFileSync(plyAbs);

function fail(msg) { console.error(`✗ ${msg}`); process.exit(2); }

let browser;
try {
    browser = await chromium.launch({ channel: 'chrome', headless: config.headless });
} catch (e) {
    fail(`Could not launch Chrome (channel: 'chrome'). Is Chrome installed?\n  ${e.message}`);
}

const page = await browser.newPage({ viewport: config.viewport, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [page error] ${m.text()}`); });

// Serve the local .ply bytes to the page without committing them anywhere.
await page.route('**/__visual_ply', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: plyBytes }));

try {
    await page.goto(`${config.baseUrl}/?test=1`, { waitUntil: 'load', timeout: 30000 });
} catch (e) {
    await browser.close();
    fail(`Could not reach ${config.baseUrl}. Start it with: cd ui && npm run dev`);
}

await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE, null, { timeout: 30000 })
    .catch(async () => { await browser.close(); fail('window.__DRISHYAM_ENGINE never appeared (is ?test=1 wired + WebGPU available?).'); });

// Load the splat once, then re-pose per case.
await page.evaluate(async () => {
    const e = window.__DRISHYAM_ENGINE;
    const buf = await (await fetch('/__visual_ply')).arrayBuffer();
    e.loadSplats(buf);
});
await page.waitForTimeout(config.settleMs);

const canvas = await page.$('canvas#glcanvas');
if (!canvas) { await browser.close(); fail('canvas#glcanvas not found.'); }

let failures = 0;
let created = 0;
const rows = [];

for (const c of cases) {
    await page.evaluate((c) => {
        const e = window.__DRISHYAM_ENGINE;
        e.camera.setPose(c.rotX, c.rotY, c.zoom);
        e.setSplatShDegree(c.sh);
        e.setSplatReduction(c.reduction);
    }, c);
    await page.waitForTimeout(config.frameMs);

    const shot = await canvas.screenshot();
    fs.writeFileSync(path.join(outputDir, `${c.name}.png`), shot);
    const goldenPath = path.join(goldenDir, `${c.name}.png`);

    if (update || !fs.existsSync(goldenPath)) {
        fs.writeFileSync(goldenPath, shot);
        created++;
        rows.push(`  ${update ? '↻ updated' : '＋ created'}  ${c.name}`);
        continue;
    }

    const golden = PNG.sync.read(fs.readFileSync(goldenPath));
    const current = PNG.sync.read(shot);
    if (golden.width !== current.width || golden.height !== current.height) {
        failures++;
        rows.push(`  ✗ FAIL     ${c.name}  size ${current.width}×${current.height} vs golden ${golden.width}×${golden.height}`);
        continue;
    }
    const diff = new PNG({ width: golden.width, height: golden.height });
    const mismatched = pixelmatch(golden.data, current.data, diff.data, golden.width, golden.height, { threshold: config.pixelThreshold });
    const ratio = mismatched / (golden.width * golden.height);
    fs.writeFileSync(path.join(outputDir, `${c.name}.diff.png`), PNG.sync.write(diff));

    if (ratio > config.threshold) {
        failures++;
        rows.push(`  ✗ FAIL     ${c.name}  ${(ratio * 100).toFixed(3)}% differ (> ${(config.threshold * 100).toFixed(2)}%)`);
    } else {
        rows.push(`  ✓ ok       ${c.name}  ${(ratio * 100).toFixed(3)}% differ`);
    }
}

await browser.close();

console.log(`\nVisual regression — ${update ? 'UPDATE' : 'COMPARE'} (${cases.length} cases)\n`);
console.log(rows.join('\n'));
if (update || created > 0) console.log(`\n${created} golden(s) written to visual/golden/.`);
if (!update && failures > 0) {
    console.error(`\n✗ ${failures} case(s) drifted. Inspect visual/output/<name>.diff.png`);
    process.exit(1);
}
if (!update) console.log('\n✓ All cases within threshold.');
