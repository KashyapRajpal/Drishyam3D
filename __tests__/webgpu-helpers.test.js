import { createTextureFromUrl, createTextureFromImageBitmap } from '../scripts/engine/webgpu-helpers.js';

describe('WebGPU Helpers', () => {
  const mockTexture = { id: 'texture' };
  const mockDevice = {
    createTexture: jest.fn(() => mockTexture),
    queue: {
      copyExternalImageToTexture: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.GPUTextureUsage = {
      TEXTURE_BINDING: 1,
      COPY_DST: 2,
      RENDER_ATTACHMENT: 4,
    };
  });

  test('createTextureFromImageBitmap uploads bitmap to GPU texture', () => {
    const imageBitmap = { width: 8, height: 4 };
    const texture = createTextureFromImageBitmap(mockDevice, imageBitmap);

    expect(texture).toBe(mockTexture);
    expect(mockDevice.createTexture).toHaveBeenCalledTimes(1);
    expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: imageBitmap },
      { texture: mockTexture },
      [8, 4]
    );
  });

  test('createTextureFromUrl throws on non-ok HTTP response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    await expect(createTextureFromUrl(mockDevice, 'https://example.com/missing.png'))
      .rejects
      .toThrow('Failed to fetch texture');
  });

  test('createTextureFromUrl fetches, decodes, and uploads texture', async () => {
    const mockBlob = {};
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => mockBlob,
    }));
    global.createImageBitmap = jest.fn(async () => ({ width: 16, height: 16 }));

    const texture = await createTextureFromUrl(mockDevice, 'https://example.com/tex.png');

    expect(texture).toBe(mockTexture);
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/tex.png');
    expect(global.createImageBitmap).toHaveBeenCalledWith(mockBlob);
    expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
  });
});
