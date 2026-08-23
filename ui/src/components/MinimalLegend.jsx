import React, { useState } from 'react'

export function MinimalLegend({ backend, uiMode, renderMode }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!isExpanded) {
    return (
      <div className="minimal-legend-collapsed">
        <button
          type="button"
          className="minimal-legend-badge"
          onClick={() => setIsExpanded(true)}
          title="Open Guide & Legend"
        >
          <span className="legend-icon">💡</span>
          <span>Quick Guide & Legend</span>
          <span className="legend-chevron">▲</span>
        </button>
      </div>
    )
  }

  return (
    <div className="minimal-legend-expanded glass-hud">
      <div className="minimal-legend-header">
        <div className="legend-title">
          <span>💡</span>
          <strong>Guide & Legend</strong>
        </div>
        <button
          type="button"
          className="legend-close-btn"
          onClick={() => setIsExpanded(false)}
          title="Collapse guide"
        >
          ✕
        </button>
      </div>

      <div className="minimal-legend-body">
        {/* BACKENDS */}
        <div className="legend-section">
          <div className="legend-section-title">ENGINE BACKENDS</div>
          <div className="legend-item">
            <span className="legend-pill webgpu">⚡ WebGPU</span>
            <span className="legend-desc">Next-gen compute shaders, GPU path tracing & hardware splat sort.</span>
          </div>
          <div className="legend-item">
            <span className="legend-pill webgl">🌐 WebGL</span>
            <span className="legend-desc">Universal standard pipeline compatible across all modern browsers.</span>
          </div>
        </div>

        {/* WORKSPACE MODES */}
        <div className="legend-section">
          <div className="legend-section-title">MODES</div>
          <div className="legend-item">
            <span className="legend-pill mode">👁️ View Mode</span>
            <span className="legend-desc">Full uncluttered 3D viewport experience.</span>
          </div>
          <div className="legend-item">
            <span className="legend-pill mode">🛠️ Studio Mode</span>
            <span className="legend-desc">Code editor for WGSL/GLSL shaders & scene scripts with file explorer.</span>
          </div>
        </div>

        {/* NAVIGATION CONTROLS */}
        <div className="legend-section">
          <div className="legend-section-title">3D VIEWPORT CONTROLS</div>
          <div className="legend-control-grid">
            <div className="legend-control-row">
              <kbd>Left Drag</kbd>
              <span>Orbit Camera</span>
            </div>
            <div className="legend-control-row">
              <kbd>Right / Shift + Drag</kbd>
              <span>Pan Camera</span>
            </div>
            <div className="legend-control-row">
              <kbd>Scroll Wheel</kbd>
              <span>Zoom In / Out</span>
            </div>
          </div>
        </div>

        {/* SHORTCUTS */}
        <div className="legend-section">
          <div className="legend-section-title">SHORTCUTS</div>
          <div className="legend-control-grid">
            <div className="legend-control-row">
              <kbd>⌘K / Ctrl+K</kbd>
              <span>Command Palette</span>
            </div>
            <div className="legend-control-row">
              <kbd>⌘↵ / Ctrl+↵</kbd>
              <span>Apply Code Changes</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

