import { Camera } from '../scripts/engine/camera.js';
import { frameCamera } from '../scripts/engine/scene-ops.js';

const mockCanvas = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
};

const splat = (radius, center = [0, 0, 0]) => ({ kind: 'splat', bounds: { center, radius } });

describe('frameCamera — limits derive from the asset scale', () => {
  let camera;
  beforeEach(() => { camera = new Camera(mockCanvas); });

  test('a small capture gets limits proportional to its radius', () => {
    // The cluster-fly captures have radius ~0.18; a fixed minZoom of 1 put the
    // near limit at ~5.5x the whole object, which read as "zoom is capped".
    frameCamera(camera, splat(0.182));
    expect(camera.zoom).toBeCloseTo(0.455, 4);
    expect(camera.minZoom).toBeCloseTo(0.0182, 4);
    expect(camera.maxZoom).toBeCloseTo(1.82, 4);
    expect(camera.minZoom).toBeLessThan(0.182); // can get closer than the radius
  });

  test('a large capture scales up the same way', () => {
    frameCamera(camera, splat(50));
    expect(camera.zoom).toBeCloseTo(125);
    expect(camera.minZoom).toBeCloseTo(5);
    expect(camera.maxZoom).toBeCloseTo(500);
  });

  test('targets the bounds center, without aliasing the drawable', () => {
    const d = splat(2, [1, 2, 3]);
    frameCamera(camera, d);
    expect(camera.target).toEqual([1, 2, 3]);
    camera.target[0] = 99;
    expect(d.bounds.center[0]).toBe(1); // panning must not mutate the bounds
  });
});

describe('frameCamera — limits must not leak between assets', () => {
  let camera;
  beforeEach(() => { camera = new Camera(mockCanvas); });

  test('a bounds-less primitive resets to defaults after a tiny splat scene', () => {
    // geometry.js drawables carry no bounds. frameCamera used to bail early, so
    // the camera kept the splat cloud's limits and Reset Scene left it *inside*
    // the cube.
    frameCamera(camera, splat(0.182));
    frameCamera(camera, { kind: 'mesh' }); // no bounds
    expect(camera.zoom).toBeCloseTo(2.5);
    expect(camera.minZoom).toBeCloseTo(0.1);
    expect(camera.maxZoom).toBeCloseTo(10);
    expect(camera.target).toEqual([0, 0, 0]);
  });

  test('maxZoom shrinks when moving from a large asset to a small one', () => {
    frameCamera(camera, splat(50));
    expect(camera.maxZoom).toBeCloseTo(500);
    frameCamera(camera, splat(0.182));
    expect(camera.maxZoom).toBeCloseTo(1.82); // assigned, not Math.max'd
  });

  test('a degenerate zero radius falls back instead of collapsing to zero', () => {
    frameCamera(camera, splat(0));
    expect(camera.zoom).toBeCloseTo(2.5);
    expect(camera.minZoom).toBeGreaterThan(0);
  });
});

describe('onWheel — zoom step is scale independent', () => {
  let camera;
  beforeEach(() => { camera = new Camera(mockCanvas); });

  const wheel = (deltaY) => camera.onWheel({ deltaY, preventDefault() {} });

  test('one notch moves the same fraction at any scale', () => {
    frameCamera(camera, splat(50));
    const big = camera.zoom;
    wheel(-100);
    const bigRatio = camera.zoom / big;

    frameCamera(camera, splat(0.182));
    const small = camera.zoom;
    wheel(-100);
    const smallRatio = camera.zoom / small;

    expect(smallRatio).toBeCloseTo(bigRatio, 6);
  });

  test('a single notch no longer crosses a small scene\'s whole range', () => {
    frameCamera(camera, splat(0.182));
    wheel(-100); // scroll in one notch
    expect(camera.zoom).toBeGreaterThan(camera.minZoom * 1.5);
  });

  test('stays within the derived limits in both directions', () => {
    frameCamera(camera, splat(0.182));
    for (let i = 0; i < 100; i++) wheel(-120);
    expect(camera.zoom).toBeCloseTo(camera.minZoom);
    for (let i = 0; i < 200; i++) wheel(120);
    expect(camera.zoom).toBeCloseTo(camera.maxZoom);
  });
});
