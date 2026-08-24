/**
 * @file Scenario recipes for automated documentation and README screenshot generation.
 * @copyright 2026 Kashyap Rajpal
 * @license MIT
 */

export const readmeScenarios = [
  {
    id: 'minimal-view-mode',
    filename: 'minimal-view-mode.png',
    title: 'Minimal View Mode',
    description: 'Clean, distraction-free 3D canvas viewport with floating glass control pill and live performance stats.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE, { timeout: 15000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'studio-edit-mode',
    filename: 'studio-edit-mode.png',
    title: 'Studio Edit Workspace',
    description: 'Comprehensive 3-panel layout: interactive File Explorer on the left, real-time 3D Viewport in the center, and live Code Editor with syntax highlighting on the right.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE, { timeout: 15000 });
      // Switch to Studio Edit Mode via UI or fallback keypress
      const editBtn = page.locator('button[title*="Edit Mode"], button:has-text("Edit Studio")');
      if (await editBtn.count() > 0) {
        await editBtn.first().click({ timeout: 2000 }).catch(() => {});
      } else {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(200);
        await page.keyboard.type('Switch to Edit');
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'cornell-box-raytrace',
    filename: 'cornell-box-raytrace.png',
    title: 'Cornell Box GPU Path Tracing',
    description: 'Progressive Monte Carlo path tracing with soft area lighting, color bleeding, and progressive SPP accumulation.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      // Explicitly wait for visual test API initialization
      await page.waitForFunction(() => !!window.__DRISHYAM_RAY_TEST, { timeout: 15000 });
      await page.evaluate(async () => {
        await window.__DRISHYAM_RAY_TEST.loadCornell('raytrace-gpu');
      });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'hybrid-shadows-gltf',
    filename: 'hybrid-shadows-gltf.png',
    title: 'glTF Rasterization + Ray-Traced Soft Shadows',
    description: 'G-Buffer deferred rasterization combined with GPU compute ray-traced shadow occlusion rays.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      // Explicitly wait for visual test API initialization
      await page.waitForFunction(() => !!window.__DRISHYAM_RAY_TEST, { timeout: 15000 });
      await page.evaluate(async () => {
        await window.__DRISHYAM_RAY_TEST.setRenderMode('hybrid-shadows');
      });
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'drishyam-splat-render',
    filename: 'drishyam-splat-render.png',
    title: '3D Gaussian Splatting',
    description: 'Real-time neural point-cloud rendering with GPU radix depth sorting and spherical harmonics.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE, { timeout: 15000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'command-palette',
    filename: 'command-palette.png',
    title: 'Universal Command Palette',
    description: 'Quick-access command launcher (⌘K / Ctrl+K) for switching layouts, loading assets, toggling render backends, and debugging.',
    viewport: { width: 1280, height: 800 },
    async run(page) {
      await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE, { timeout: 15000 });
      const cmdBtn = page.locator('button[title*="Command Palette"], button:has-text("⌘K")');
      if (await cmdBtn.count() > 0) {
        await cmdBtn.first().click({ timeout: 2000 }).catch(() => {});
      } else {
        await page.keyboard.press('Control+k');
      }
      await page.waitForTimeout(300);
    },
  },
];