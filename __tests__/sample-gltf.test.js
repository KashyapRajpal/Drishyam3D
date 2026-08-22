jest.mock('../scripts/engine/gltf-parser.js', () => ({
  parseGltfForBackend: jest.fn(),
}));

import { parseGltfForBackend } from '../scripts/engine/gltf-parser.js';
import { loadSampleGltf, SAMPLE_GLTF_MODEL } from '../scripts/engine/scene-ops.js';

describe('built-in glTF sample', () => {
  test('loads the attributed external-file Chronograph Watch and frames it', async () => {
    const drawable = { bounds: { center: [1, 2, 3], radius: 4 } };
    parseGltfForBackend.mockResolvedValue(drawable);
    const engine = {
      scene: { loadGeometry: jest.fn() },
      camera: {
        target: [0, 0, 0], zoom: 1, minZoom: 1, maxZoom: 20,
        updateViewMatrix: jest.fn(),
      },
    };

    await expect(loadSampleGltf({ engine })).resolves.toBe(drawable);
    expect(SAMPLE_GLTF_MODEL).toMatchObject({
      name: 'Chronograph Watch',
      license: 'CC BY 4.0',
      cameraZoomScale: 3.2,
    });
    expect(SAMPLE_GLTF_MODEL.sourceUrl).toMatch(/KhronosGroup\/glTF-Sample-Assets/);
    expect(parseGltfForBackend).toHaveBeenCalledWith(
      engine,
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ChronographWatch/glTF/ChronographWatch.gltf',
    );
    expect(engine.scene.loadGeometry).toHaveBeenCalledWith(drawable);
    expect(engine.camera).toMatchObject({
      target: [1, 2, 3], zoom: 12.8, minZoom: 0.4, maxZoom: 40,
    });
    expect(engine.camera.updateViewMatrix).toHaveBeenCalledTimes(1);
  });
});
