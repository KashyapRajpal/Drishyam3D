import {
  DEFAULT_HYBRID_LIGHT,
  DEFAULT_RAY_TRACING_SETTINGS,
  mergeHybridLight,
  mergeRayTracingSettings,
} from '../ui/src/ray-control-state.js'

describe('ray control state', () => {
  test('normalizes progressive settings to renderer limits', () => {
    expect(mergeRayTracingSettings(DEFAULT_RAY_TRACING_SETTINGS, {
      maxBounces: 99,
      samplesPerFrame: 2.4,
    })).toEqual({ maxBounces: 16, samplesPerFrame: 2 })

    expect(mergeRayTracingSettings({ maxBounces: 8, samplesPerFrame: 4 }, {
      maxBounces: 'invalid',
    })).toEqual({ maxBounces: 4, samplesPerFrame: 4 })
  })

  test('keeps complete, independent hybrid light vectors across type changes', () => {
    const point = mergeHybridLight(DEFAULT_HYBRID_LIGHT, {
      type: 'point',
      position: [-2, 4, 3],
      intensity: 2.5,
    })

    expect(point).toMatchObject({ type: 'point', position: [-2, 4, 3], intensity: 2.5 })
    expect(point.direction).toEqual([-0.5, -1, -0.3])
    expect(point.position).not.toBe(DEFAULT_HYBRID_LIGHT.position)

    const directional = mergeHybridLight(point, { type: 'directional', direction: [0, -1, 0] })
    expect(directional).toMatchObject({
      type: 'directional',
      direction: [0, -1, 0],
      position: [-2, 4, 3],
    })
  })

  test('rejects invalid light fields without producing renderer errors', () => {
    const light = mergeHybridLight(DEFAULT_HYBRID_LIGHT, {
      type: 'spot',
      direction: [0, Number.NaN, 0],
      intensity: -2,
    })

    expect(light.type).toBe('directional')
    expect(light.direction).toEqual(DEFAULT_HYBRID_LIGHT.direction)
    expect(light.intensity).toBe(0)
  })
})
