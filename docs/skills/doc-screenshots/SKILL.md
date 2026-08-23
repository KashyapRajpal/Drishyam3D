---
name: doc-screenshots
description: Automated capture and maintenance of high-resolution visual screenshots for README and documentation.
---

# Documentation Screenshot Automation Guide

Drishyam3D uses an automated Playwright workflow to capture 2x retina documentation screenshots and inject them into `README.md`.

## Quick Start

1. Start the local development server:
   ```bash
   cd ui && npm run dev
   ```

2. Capture all documentation screenshots and update the README gallery:
   ```bash
   npm run docs:screenshots
   ```

## Adding a New Screenshot Scenario

1. Open `visual/readme-scenarios.mjs`.
2. Add a new scenario object to `readmeScenarios`:
   ```javascript
   {
     id: 'new-feature-id',
     filename: 'new-feature.png',
     title: 'Feature Display Name',
     description: 'Concise explanation of the capability shown.',
     viewport: { width: 1280, height: 800 },
     async run(page) {
       await page.waitForFunction(() => !!window.__DRISHYAM_ENGINE);
       // Interact with the UI, load shaders, or trigger render modes
     }
   }
   ```
3. Run `npm run docs:screenshots`.
4. Commit the new image asset under `assets/screenshots/` and the updated `README.md`.
