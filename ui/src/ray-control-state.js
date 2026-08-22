export const RAY_SETTING_OPTIONS = Object.freeze([1, 2, 4, 8, 16])

export const DEFAULT_RAY_TRACING_SETTINGS = Object.freeze({
  maxBounces: 4,
  samplesPerFrame: 1,
})

export const DEFAULT_HYBRID_LIGHT = Object.freeze({
  type: 'directional',
  direction: Object.freeze([-0.5, -1, -0.3]),
  position: Object.freeze([2, 3, 2]),
  color: Object.freeze([1, 1, 1]),
  intensity: 1,
  ambient: 0.2,
  exposure: 1,
})

function clampInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(16, Math.max(1, Math.round(numeric)))
}

function copyVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    return [...fallback]
  }
  return [...value]
}

export function mergeRayTracingSettings(current = DEFAULT_RAY_TRACING_SETTINGS, partial = {}) {
  return {
    maxBounces: clampInteger(partial.maxBounces ?? current.maxBounces, DEFAULT_RAY_TRACING_SETTINGS.maxBounces),
    samplesPerFrame: clampInteger(partial.samplesPerFrame ?? current.samplesPerFrame, DEFAULT_RAY_TRACING_SETTINGS.samplesPerFrame),
  }
}

export function mergeHybridLight(current = DEFAULT_HYBRID_LIGHT, partial = {}) {
  const next = { ...current, ...partial }
  return {
    ...next,
    type: next.type === 'point' ? 'point' : 'directional',
    direction: copyVector(next.direction, DEFAULT_HYBRID_LIGHT.direction),
    position: copyVector(next.position, DEFAULT_HYBRID_LIGHT.position),
    color: copyVector(next.color, DEFAULT_HYBRID_LIGHT.color),
    intensity: Math.max(0, Number.isFinite(Number(next.intensity)) ? Number(next.intensity) : DEFAULT_HYBRID_LIGHT.intensity),
    ambient: Math.max(0, Number.isFinite(Number(next.ambient)) ? Number(next.ambient) : DEFAULT_HYBRID_LIGHT.ambient),
    exposure: Math.max(0, Number.isFinite(Number(next.exposure)) ? Number(next.exposure) : DEFAULT_HYBRID_LIGHT.exposure),
  }
}
