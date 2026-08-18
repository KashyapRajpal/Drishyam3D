import React from 'react'

const MODES = [
  { value: 'raster', label: 'Raster' },
  { value: 'raytrace-cpu', label: 'CPU path tracing' },
  { value: 'raytrace-gpu', label: 'GPU path tracing', webgpu: true },
  { value: 'hybrid-shadows', label: 'Hybrid ray-traced shadows', webgpu: true },
]

function unavailableReason(mode, { backend, hasRayScene, hasHybridScene, capabilities }) {
  if (mode.value === 'raster') return null
  if (mode.webgpu && backend !== 'webgpu') return 'Switch the raster backend to WebGPU first.'
  if (mode.value === 'hybrid-shadows' && !hasHybridScene) {
    return 'Load a ray-traceable glTF raster scene first.'
  }
  if (!hasRayScene) return 'Load a ray-traceable glTF or a Cornell Box example first.'
  const capability = capabilities?.[mode.value]
  if (capability && !capability.available) return capability.reason || `${mode.label} is unavailable.`
  return null
}

export function RayTracingControls({
  backend,
  renderMode,
  hasRayScene,
  hasHybridScene,
  capabilities,
  paused,
  onSelectMode,
  onTogglePause,
  onResetAccumulation,
}) {
  const progressive = renderMode === 'raytrace-cpu' || renderMode === 'raytrace-gpu'
  const rayMode = renderMode !== 'raster'

  return (
    <>
      <div className="menu-label ray-menu-label">Render Mode</div>
      {MODES.map((mode) => {
        const reason = unavailableReason(mode, { backend, hasRayScene, hasHybridScene, capabilities })
        return (
          <a
            key={mode.value}
            href="#"
            className={reason ? 'disabled' : ''}
            aria-disabled={reason ? 'true' : undefined}
            title={reason || `Switch to ${mode.label}`}
            style={renderMode === mode.value ? { fontWeight: 'bold' } : {}}
            onClick={(event) => {
              event.preventDefault()
              if (!reason) onSelectMode(mode.value)
            }}
          >
            {mode.label}
          </a>
        )
      })}
      {rayMode && (
        <>
          <div className="menu-separator" />
          <div className="menu-label ray-menu-label">Ray Controls</div>
          <a href="#" onClick={(event) => { event.preventDefault(); onTogglePause() }}>
            {paused ? 'Resume rendering' : 'Pause rendering'}
          </a>
          <a
            href="#"
            className={progressive ? '' : 'disabled'}
            aria-disabled={progressive ? undefined : 'true'}
            title={progressive ? 'Clear progressive accumulation' : 'Hybrid shadows do not accumulate.'}
            onClick={(event) => {
              event.preventDefault()
              if (progressive) onResetAccumulation()
            }}
          >
            Reset accumulation
          </a>
        </>
      )}
    </>
  )
}
