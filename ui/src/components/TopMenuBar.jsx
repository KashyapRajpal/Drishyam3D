import React, { useState, useEffect, useRef } from 'react'

export function TopMenuBar({
  backend,
  setBackend,
  uiMode,
  setUiMode,
  textured,
  setTextured,
  currentShape,
  onSelectShape,
  splatLoaded,
  splatDebug,
  setSplatDebug,
  showStats,
  setShowStats,
  showExplorer,
  setShowExplorer,
  showEditorPanel,
  setShowEditorPanel,
  compareMode,
  setCompareMode,
  onLoadSampleModel,
  onLoadSampleHybridShadows,
  onLoadAssetFolder,
  onLoadCornellBox,
  onLoadGpuCornellBox,
  onOpenLocalFile,
  onSaveActiveFile,
  onResetScene,
  onOpenCommandPalette,
  onOpenShortcutsModal,
  logoJpg,
  renderMode,
  RayTracingControlsContent,
}) {
  const [activeMenu, setActiveMenu] = useState(null)
  const navRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleMenu = (menuName) => {
    setActiveMenu((prev) => (prev === menuName ? null : menuName))
  }

  return (
    <header className="topbar" ref={navRef}>
      <div className="brand" onClick={() => setUiMode((m) => (m === 'view' ? 'edit' : 'view'))} style={{ cursor: 'pointer' }}>
        {logoJpg ? (
          <img src={logoJpg} alt="Drishyam3D" className="logo-img" />
        ) : (
          <div className="logo-placeholder">3D</div>
        )}
        <span className="title">Drishyam3D</span>
        {/*<span className="version-pill">v1.0</span>*/}
      </div>

      <nav className="menu">
        {/* FILE MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'file' ? 'active' : ''}`}
            onClick={() => toggleMenu('file')}
          >
            File
          </button>
          {activeMenu === 'file' && (
            <div className="dropdown-content">
              <a href="#" onClick={(e) => { e.preventDefault(); onLoadAssetFolder(); setActiveMenu(null) }}>
                📂 Load Asset Folder…
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); onLoadSampleModel(); setActiveMenu(null) }}>
                📦 Load Sample glTF
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenLocalFile(); setActiveMenu(null) }}>
                📄 Open Local File…
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); onSaveActiveFile(); setActiveMenu(null) }}>
                💾 Save File <kbd>⌘S</kbd>
              </a>
              <div className="menu-separator" />
              <a href="#" onClick={(e) => { e.preventDefault(); onResetScene(); setActiveMenu(null) }}>
                🔄 Reset Scene
              </a>
            </div>
          )}
        </div>

        {/* EXAMPLES MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'examples' ? 'active' : ''}`}
            onClick={() => toggleMenu('examples')}
          >
            Examples
          </button>
          {activeMenu === 'examples' && (
            <div className="dropdown-content wider-dropdown">
              <a
                href="#"
                className={renderMode === 'raytrace-cpu' ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); onLoadCornellBox(); setActiveMenu(null) }}
              >
                🏛️ Cornell Box (CPU Path Tracing)
              </a>
              <a
                href="#"
                className={renderMode === 'raytrace-gpu' ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); onLoadGpuCornellBox(); setActiveMenu(null) }}
              >
                ⚡ Cornell Box (GPU Path Tracing)
              </a>
              <a
                href="#"
                className={renderMode === 'hybrid-shadows' ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); onLoadSampleHybridShadows(); setActiveMenu(null) }}
              >
                📦 Sample glTF (Ray-Traced Shadows)
              </a>
            </div>
          )}
        </div>

        {/* SHAPES MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'shapes' ? 'active' : ''}`}
            onClick={() => toggleMenu('shapes')}
          >
            Shapes
          </button>
          {activeMenu === 'shapes' && (
            <div className="dropdown-content">
              <a href="#" onClick={(e) => { e.preventDefault(); setTextured(!textured) }}>
                {textured ? '☑️ Textured' : '☐ Textured'}
              </a>
              <div className="menu-separator" />
              <a
                href="#"
                className={currentShape === 'cube' && !splatLoaded ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); onSelectShape('cube'); setActiveMenu(null) }}
              >
                🟥 Cube
              </a>
              <a
                href="#"
                className={currentShape === 'sphere' && !splatLoaded ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); onSelectShape('sphere'); setActiveMenu(null) }}
              >
                🟢 Sphere
              </a>
            </div>
          )}
        </div>

        {/* RENDER ENGINE MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'render' ? 'active' : ''}`}
            onClick={() => toggleMenu('render')}
          >
            Render Engine
          </button>
          {activeMenu === 'render' && (
            <div className="dropdown-content wider-dropdown">
              <div className="menu-section-header">Backend</div>
              <a
                href="#"
                className={backend === 'webgpu' && renderMode === 'raster' ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); setBackend('webgpu'); setActiveMenu(null) }}
              >
                ⚡ WebGPU Backend
              </a>
              <a
                href="#"
                className={backend === 'webgl' && renderMode === 'raster' ? 'active-item' : ''}
                onClick={(e) => { e.preventDefault(); setBackend('webgl'); setActiveMenu(null) }}
              >
                🌐 WebGL Backend
              </a>

              {splatLoaded && (
                <>
                  <div className="menu-separator" />
                  <div className="menu-section-header">Splat Debug</div>
                  <a
                    href="#"
                    className={splatDebug === 'off' ? 'active-item' : ''}
                    onClick={(e) => { e.preventDefault(); setSplatDebug('off'); setActiveMenu(null) }}
                  >
                    Off (Full Splats)
                  </a>
                  <a
                    href="#"
                    className={splatDebug === 'points' ? 'active-item' : ''}
                    onClick={(e) => { e.preventDefault(); setSplatDebug('points'); setActiveMenu(null) }}
                  >
                    Points (Centers)
                  </a>
                  <a
                    href="#"
                    className={splatDebug === 'points-sorted' ? 'active-item' : ''}
                    onClick={(e) => { e.preventDefault(); setSplatDebug('points-sorted'); setActiveMenu(null) }}
                  >
                    Points (Sorted Depth)
                  </a>
                </>
              )}

              {RayTracingControlsContent && (
                <>
                  <div className="menu-separator" />
                  {RayTracingControlsContent}
                </>
              )}
            </div>
          )}
        </div>

        {/* VIEW MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'view' ? 'active' : ''}`}
            onClick={() => toggleMenu('view')}
          >
            View
          </button>
          {activeMenu === 'view' && (
            <div className="dropdown-content">
              <a href="#" onClick={(e) => { e.preventDefault(); setShowExplorer(!showExplorer) }}>
                {showExplorer ? '☑️ File Explorer' : '☐ File Explorer'}
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); setShowEditorPanel(!showEditorPanel) }}>
                {showEditorPanel ? '☑️ Code Editor Panel' : '☐ Code Editor Panel'}
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); setShowStats(!showStats) }}>
                {showStats ? '☑️ Performance Stats HUD' : '☐ Performance Stats HUD'}
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); setCompareMode(!compareMode) }}>
                {compareMode ? '☑️ Compare Split Slider' : '☐ Compare Split Slider'}
              </a>
              <div className="menu-separator" />
              <a href="#" onClick={(e) => { e.preventDefault(); setUiMode('view'); setActiveMenu(null) }}>
                👁️ Switch to Minimal View Mode
              </a>
            </div>
          )}
        </div>

        {/* HELP MENU */}
        <div className="menu-container">
          <button
            type="button"
            className={`menu-btn ${activeMenu === 'help' ? 'active' : ''}`}
            onClick={() => toggleMenu('help')}
          >
            Help
          </button>
          {activeMenu === 'help' && (
            <div className="dropdown-content">
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenCommandPalette(); setActiveMenu(null) }}>
                🔍 Command Palette <kbd>⌘K</kbd>
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenShortcutsModal(); setActiveMenu(null) }}>
                ⌨️ Keyboard Shortcuts
              </a>
            </div>
          )}
        </div>
      </nav>

      <div className="top-controls">
        <button
          type="button"
          className="cmd-palette-launcher-btn"
          onClick={onOpenCommandPalette}
          title="Search actions (Cmd+K)"
        >
          <span>🔍 Search...</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="ui-mode-toggle-btn"
          onClick={() => setUiMode('view')}
          title="Minimal View Mode"
        >
          👁️ View Mode
        </button>
      </div>
    </header>
  )
}
