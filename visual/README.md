# Visual regression harness (local-only)

Screenshot-compares the WebGPU splat renderer against golden images at fixed
camera poses, SH degrees, and reduction modes — so quality regressions that unit
tests can't catch get caught.

**Everything here is local.** The test `.ply` and the golden images are gitignored
(`visual/golden/`, `visual/output/`, `visual/local.config.json`) because the capture
data is unlicensed and must not be pushed to GitHub. Only the runner, the case list,
and this README are committed.

## One-time setup

```bash
npm install                      # pulls playwright, pixelmatch, pngjs (devDeps)
```

Uses your installed **Chrome** (`channel: 'chrome'`) for real WebGPU — no separate
browser download. The test capture is expected at
`assets/3dgs/source/3DGS.ply TRE.ply`; to point elsewhere, copy
`visual/local.config.example.json` → `visual/local.config.json` and edit `plyPath`.

## Use

```bash
# terminal 1 — the app
cd ui && npm run dev

# terminal 2 — the harness
npm run visual:update            # generate/refresh goldens from the CURRENT build
npm run visual                   # compare; exits non-zero on drift
```

Typical loop: after a render change, run `npm run visual`. If a case fails, open
`visual/output/<name>.diff.png` (differing pixels highlighted). If the change is
intended, re-bless with `npm run visual:update`.

## What the cases cover

See [`cases.mjs`](cases.mjs) — camera angles (front/side/3-quarter/top), an SH-degree
sweep (0→3), and None vs Culled reduction. Add rows freely; each `name` is one golden.

- **None vs Culled at the same pose** should be near-identical when the scene stays
  on-screen — a growing diff there flags a culling bug (e.g. edge splats dropped).
- **SH sweep** pins view-dependent colour; degrees should converge toward degree 3.

## How it works

`?test=1` boots the app straight into WebGPU and exposes `window.__DRISHYAM_ENGINE`.
The runner serves the local `.ply` bytes via an intercepted route, calls
`engine.loadSplats`, then per case drives `camera.setPose` / `setSplatShDegree` /
`setSplatReduction`, screenshots `#glcanvas`, and diffs with pixelmatch.
