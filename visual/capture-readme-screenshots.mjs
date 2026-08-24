/**
 * @file Headless capture script for documentation and README screenshots.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readmeScenarios } from './readme-scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const screenshotsDir = path.join(root, 'assets', 'screenshots');
const readmePath = path.join(root, 'README.md');

const defaults = {
  baseUrl: 'http://localhost:5173/Drishyam3D',
  deviceScaleFactor: 2,
  headless: false,
};

let config = { ...defaults };
const cfgPath = path.join(here, 'local.config.json');
if (fs.existsSync(cfgPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
  } catch (e) { /* ignore */ }
}

fs.mkdirSync(screenshotsDir, { recursive: true });

function formatReadmeGallery(scenarios) {
  let output = '<!-- AUTO_SCREENSHOT_GALLERY:START -->\n';
  output += '<div align="center">\n\n';
  output += '| Workspace / Mode | Feature Description |\n';
  output += '| :--- | :--- |\n';

  for (const s of scenarios) {
    output += `| **${s.title}**<br><br><img src="assets/screenshots/${s.filename}" width="420" alt="${s.title}"/> | ${s.description} |\n`;
  }

  output += '\n</div>\n<!-- AUTO_SCREENSHOT_GALLERY:END -->';
  return output;
}

export function syncReadmeGallery(scenarios = readmeScenarios) {
  if (!fs.existsSync(readmePath)) return;
  let readme = fs.readFileSync(readmePath, 'utf8');
  const startTag = '<!-- AUTO_SCREENSHOT_GALLERY:START -->';
  const endTag = '<!-- AUTO_SCREENSHOT_GALLERY:END -->';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1) {
    const galleryMarkdown = formatReadmeGallery(scenarios);
    readme = readme.slice(0, startIndex) + galleryMarkdown + readme.slice(endIndex + endTag.length);
    fs.writeFileSync(readmePath, readme, 'utf8');
    console.log('✓ README.md screenshot gallery synchronized successfully.');
  }
}

async function run() {
  console.log('🚀 Starting Drishyam3D Documentation Screenshot Capture...');

  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: config.headless,
      args: ['--enable-unsafe-webgpu', '--use-gl=angle'],
    });
  } catch (err) {
    console.warn(`Could not launch local Chrome: ${err.message}. Syncing README markdown only.`);
    syncReadmeGallery(readmeScenarios);
    return;
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: config.deviceScaleFactor,
  });

  const page = await context.newPage();

  try {
    await page.goto(`${config.baseUrl}/?test=1`, { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    console.warn(`⚠️ Dev server at ${config.baseUrl} not reachable. Start with 'cd ui && npm run dev'. Syncing README markdown.`);
    await browser.close();
    syncReadmeGallery(readmeScenarios);
    return;
  }

  for (const scenario of readmeScenarios) {
    console.log(`📸 Capturing: ${scenario.title} (${scenario.filename})...`);
    if (scenario.viewport) {
      await page.setViewportSize(scenario.viewport);
    }
    await scenario.run(page);

    const outPath = path.join(screenshotsDir, scenario.filename);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`   Saved -> ${path.relative(root, outPath)}`);
  }

  await browser.close();
  syncReadmeGallery(readmeScenarios);
  console.log('✅ Screenshot capture and README gallery sync complete!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error('✗ Capture failed:', err);
    process.exit(1);
  });
}