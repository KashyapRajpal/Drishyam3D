import React, { useState, useRef, useEffect } from 'react'

export function FloatingControlBar({
  uiMode,
  setUiMode,
  backend,
  setBackend,
  splatLoaded,
  splatDebug,
  setSplatDebug,
  showStats,
  setShowStats,
  renderMode,
  setRenderMode,
  onOpenCommandPalette,
  onResetScene,
  onToggleFullscreen,
  isFullscreen,
  logoJpg,
  stats,
  paused,
  onTogglePause,
}) {
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false)
  const modeMenuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target)) {
        setIsModeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const modeLabels = {
    raster: '🖥️ Raster',
    'raytrace-cpu': '🏛️ CPU Path Tracing',
    'raytrace-gpu': '⚡ GPU Path Tracing',
    'hybrid-shadows': '📦 Hybrid Shadows',
  }

  const isProgressive = renderMode === 'raytrace-cpu' || renderMode === 'raytrace-gpu'

  return (
    <div className="floating-control-bar glass-panel">
      {/* Brand with Logo */}
      <div className="floating-brand">
        {logoJpg ? (
          <img src={logoJpg} alt="Drishyam3D Logo" className="floating-logo-img" />
        ) : (
          <span className="brand-dot" />
        )}
        <span className="brand-title">Drishyam3D</span>
      </div>

      <div className="floating-divider" />

      {/* Backend Switcher */}
      <button
        type="button"
        className={`floating-badge ${backend === 'webgpu' ? 'webgpu-active' : ''}`}
        title="Toggle Render Backend (WebGPU / WebGL)"
        onClick={() => setBackend((b) => (b === 'webgpu' ? 'webgl' : 'webgpu'))}
      >
        <span className="badge-icon">⚡</span>
        <span>{backend.toUpperCase()}</span>
      </button>

      {/* Render Mode & Ray Tracing Selector */}
      <div className="floating-mode-container" ref={modeMenuRef}>
        <button
          type="button"
          className={`floating-button mode-selector-btn ${renderMode !== 'raster' ? 'ray-active' : ''}`}
          onClick={() => setIsModeDropdownOpen((v) => !v)}
          title="Switch Render / Ray Tracing Mode"
        >
          <span className="button-icon">✨</span>
          <span>{modeLabels[renderMode] || 'Render Mode'}</span>
          <span className="caret-arrow">▾</span>
        </button>

        {isModeDropdownOpen && (
          <div className="floating-mode-dropdown glass-hud">
            <div className="dropdown-section-title">RENDER & RAY TRACING</div>
            <button
              type="button"
              className={`dropdown-mode-item ${renderMode === 'raster' ? 'active' : ''}`}
              onClick={() => {
                setRenderMode('raster')
                setIsModeDropdownOpen(false)
              }}
            >
              <div className="item-title">🖥️ Standard Raster</div>
              <div className="item-desc">Hardware triangle rasterization & splat rendering</div>
            </button>

            <button
              type="button"
              className={`dropdown-mode-item ${renderMode === 'raytrace-cpu' ? 'active' : ''}`}
              onClick={() => {
                setRenderMode('raytrace-cpu')
                setIsModeDropdownOpen(false)
              }}
            >
              <div className="item-title">🏛️ CPU Path Tracing</div>
              <div className="item-desc">Multi-threaded software raytracer with Cornell Box</div>
            </button>

            <button
              type="button"
              className={`dropdown-mode-item ${renderMode === 'raytrace-gpu' ? 'active' : ''}`}
              onClick={() => {
                setRenderMode('raytrace-gpu')
                setIsModeDropdownOpen(false)
              }}
            >
              <div className="item-title">⚡ GPU Path Tracing (WebGPU)</div>
              <div className="item-desc">Compute shader BVH traversal with global illumination</div>
            </button>

            <button
              type="button"
              className={`dropdown-mode-item ${renderMode === 'hybrid-shadows' ? 'active' : ''}`}
              onClick={() => {
                setRenderMode('hybrid-shadows')
                setIsModeDropdownOpen(false)
              }}
            >
              <div className="item-title">📦 Hybrid Ray-Traced Shadows</div>
              <div className="item-desc">Real-time G-buffer rasterization with ray-traced shadows</div>
            </button>
          </div>
        )}
      </div>

      {/* Progressive Path Tracing Controls */}
      {isProgressive && (
        <div className="floating-ray-status">
          <span className="spp-badge">{stats?.spp || 0} SPP</span>
          {onTogglePause && (
            <button
              type="button"
              className="floating-icon-button pause-btn"
              onClick={onTogglePause}
              title={paused ? 'Resume Path Tracing' : 'Pause Path Tracing'}
            >
              {paused ? '▶' : '⏸'}
            </button>
          )}
        </div>
      )}

      {/* Splat Debug Toggle */}
      {splatLoaded && (
        <button
          type="button"
          className={`floating-button ${splatDebug !== 'off' ? 'active' : ''}`}
          title={`Splat Debug Mode: ${splatDebug}`}
          onClick={() => {
            const next = splatDebug === 'off' ? 'points' : splatDebug === 'points' ? 'points-sorted' : 'off'
            setSplatDebug(next)
          }}
        >
          <span className="button-icon">🪄</span>
          <span>Debug: {splatDebug}</span>
        </button>
      )}

      {/* Stats HUD Toggle */}
      <button
        type="button"
        className={`floating-button ${showStats ? 'active' : ''}`}
        title="Toggle Real-time Performance HUD"
        onClick={() => setShowStats((s) => !s)}
      >
        <span className="button-icon">📊</span>
        <span>Stats</span>
      </button>

      {/* Command Palette Launcher */}
      <button
        type="button"
        className="floating-button"
        title="Open Command Palette (Cmd+K)"
        onClick={onOpenCommandPalette}
      >
        <span className="button-icon">🔍</span>
        <kbd className="kbd-hint">⌘K</kbd>
      </button>

      <div className="floating-divider" />

      {/* Switch to Studio Edit Mode */}
      <button
        type="button"
        className="mode-switch-button"
        title={uiMode === 'view' ? 'Switch to Studio Edit Mode' : 'Switch to Minimal View Mode'}
        onClick={() => setUiMode((m) => (m === 'view' ? 'edit' : 'view'))}
      >
        <span className="button-icon">{uiMode === 'view' ? '🛠️' : '👁️'}</span>
        <span>{uiMode === 'view' ? 'Studio Mode' : 'View Mode'}</span>
      </button>

      {/* Fullscreen Toggle */}
      <button
        type="button"
        className="floating-icon-button"
        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? '↙' : '⤢'}
      </button>
    </div>
  )
}
