import React from 'react'
import { RAY_SETTING_OPTIONS } from '../ray-control-state.js'

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

function ChoiceRow({ label, value, options, onChange }) {
  return (
    <div className="ray-control-row">
      <span className="ray-control-label">{label}</span>
      <div className="ray-choice-group">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`ray-choice ${value === option ? 'selected' : ''}`}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function VectorControl({ label, value, min, max, step, onChange }) {
  return (
    <div className="ray-vector-control">
      <div className="ray-control-caption">{label}</div>
      {['X', 'Y', 'Z'].map((axis, index) => (
        <label className="ray-slider-row" key={axis}>
          <span>{axis}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[index]}
            onChange={(event) => {
              const next = [...value]
              next[index] = Number(event.target.value)
              onChange(next)
            }}
          />
          <output>{value[index].toFixed(1)}</output>
        </label>
      ))}
    </div>
  )
}

export function RayTracingControls({
  backend,
  renderMode,
  hasRayScene,
  hasHybridScene,
  capabilities,
  paused,
  spp,
  raySettings,
  hybridLight,
  onSelectMode,
  onTogglePause,
  onResetAccumulation,
  onChangeRaySettings,
  onChangeHybridLight,
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
          {progressive ? (
            <div className="ray-controls-panel">
              <div className="menu-label ray-menu-label">Progressive Path Tracing</div>
              <div className="ray-control-row">
                <span className="ray-control-label">Current SPP</span>
                <output className="ray-readout">{spp}</output>
              </div>
              <ChoiceRow
                label="Max bounces"
                value={raySettings.maxBounces}
                options={RAY_SETTING_OPTIONS}
                onChange={(maxBounces) => onChangeRaySettings({ maxBounces })}
              />
              <ChoiceRow
                label="Samples/frame"
                value={raySettings.samplesPerFrame}
                options={RAY_SETTING_OPTIONS}
                onChange={(samplesPerFrame) => onChangeRaySettings({ samplesPerFrame })}
              />
              <a href="#" onClick={(event) => { event.preventDefault(); onTogglePause() }}>
                {paused ? 'Resume accumulation' : 'Pause accumulation'}
              </a>
              <a href="#" onClick={(event) => { event.preventDefault(); onResetAccumulation() }}>
                Reset accumulation
              </a>
            </div>
          ) : (
            <div className="ray-controls-panel">
              <div className="menu-label ray-menu-label">Hybrid Lighting</div>
              <ChoiceRow
                label="Light type"
                value={hybridLight.type}
                options={['directional', 'point']}
                onChange={(type) => onChangeHybridLight({ type })}
              />
              <label className="ray-slider-row ray-intensity-row">
                <span>Intensity</span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={hybridLight.intensity}
                  onChange={(event) => onChangeHybridLight({ intensity: Number(event.target.value) })}
                />
                <output>{hybridLight.intensity.toFixed(1)}</output>
              </label>
              {hybridLight.type === 'directional' ? (
                <VectorControl
                  label="Light direction"
                  value={hybridLight.direction}
                  min={-1}
                  max={1}
                  step={0.1}
                  onChange={(direction) => onChangeHybridLight({ direction })}
                />
              ) : (
                <VectorControl
                  label="Light position"
                  value={hybridLight.position}
                  min={-10}
                  max={10}
                  step={0.1}
                  onChange={(position) => onChangeHybridLight({ position })}
                />
              )}
              <div className="ray-control-row">
                <span className="ray-control-label">Shadow</span>
                <div className="ray-choice-group">
                  <button type="button" className="ray-choice selected" aria-pressed="true">Hard</button>
                  <button
                    type="button"
                    className="ray-choice"
                    disabled
                    title="Soft shadow sampling is planned after the MVP."
                  >
                    Soft · planned
                  </button>
                </div>
              </div>
              <div className="ray-control-caption">Animation + rendering</div>
              <a href="#" onClick={(event) => { event.preventDefault(); onTogglePause() }}>
                {paused ? 'Resume live scene' : 'Pause live scene'}
              </a>
            </div>
          )}
        </>
      )}
    </>
  )
}
