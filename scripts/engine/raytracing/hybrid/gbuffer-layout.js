export const HYBRID_GBUFFER_FORMATS = Object.freeze({
    worldPosition: 'rgba16float',
    normal: 'rgba16float',
    albedo: 'rgba8unorm',
    depth: 'depth24plus',
    visibility: 'rgba8unorm',
});

function createAttachment(device, label, size, format, usage) {
    const texture = device.createTexture({ label, size, format, usage });
    return { texture, view: texture.createView() };
}

export function createHybridGBuffer(device, width, height) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error('Hybrid G-buffer dimensions must be positive integers.');
    }
    const colorUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const created = [];
    try {
        const worldPosition = createAttachment(
            device, 'Hybrid world-position G-buffer', [width, height, 1],
            HYBRID_GBUFFER_FORMATS.worldPosition, colorUsage,
        );
        created.push(worldPosition.texture);
        const normal = createAttachment(
            device, 'Hybrid normal G-buffer', [width, height, 1],
            HYBRID_GBUFFER_FORMATS.normal, colorUsage,
        );
        created.push(normal.texture);
        const albedo = createAttachment(
            device, 'Hybrid albedo G-buffer', [width, height, 1],
            HYBRID_GBUFFER_FORMATS.albedo, colorUsage,
        );
        created.push(albedo.texture);
        const depth = createAttachment(
            device, 'Hybrid depth buffer', [width, height, 1],
            HYBRID_GBUFFER_FORMATS.depth, GPUTextureUsage.RENDER_ATTACHMENT,
        );
        created.push(depth.texture);
        return { width, height, worldPosition, normal, albedo, depth, destroyed: false };
    } catch (error) {
        for (const texture of created) texture.destroy?.();
        throw error;
    }
}

export function destroyHybridGBuffer(gbuffer) {
    if (!gbuffer || gbuffer.destroyed) return;
    gbuffer.destroyed = true;
    for (const attachment of [gbuffer.worldPosition, gbuffer.normal, gbuffer.albedo, gbuffer.depth]) {
        attachment?.texture?.destroy?.();
    }
}

export function createHybridVisibilityFallback(device) {
    const texture = device.createTexture({
        label: 'Hybrid constant-visible shadow texture',
        size: [1, 1, 1],
        format: HYBRID_GBUFFER_FORMATS.visibility,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
        { texture },
        new Uint8Array([255, 0, 0, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
    );
    return texture;
}

export function createHybridVisibilityTarget(device, width, height) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error('Hybrid visibility dimensions must be positive integers.');
    }
    const texture = device.createTexture({
        label: 'Hybrid ray-traced visibility',
        size: [width, height, 1],
        format: HYBRID_GBUFFER_FORMATS.visibility,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    return { width, height, texture, view: texture.createView(), destroyed: false };
}

export function destroyHybridVisibilityTarget(target) {
    if (!target || target.destroyed) return;
    target.destroyed = true;
    target.texture?.destroy?.();
}
