import React, {useState, useRef, useEffect, useMemo} from 'react'
import CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/dracula.css'
import 'codemirror/mode/javascript/javascript'
import 'codemirror/mode/clike/clike'
import { initEngine } from '@engine/app-facade.js'
import defaultVert from '@assets/shaders/default.vert?raw'
import defaultFrag from '@assets/shaders/default.frag?raw'
import defaultScript from '@scripts/scene-script.js?raw'
import logoPng from '@assets/logo/drishyam3d_logo.png'
import { setupMenuHandlers } from '@engine/menu-handlers.js'
import { setupSettings } from '@engine/settings.js'

const shaderFiles = import.meta.glob('../../assets/shaders/**/*.{vert,frag,glsl}', { query: '?raw', import: 'default', eager: true })
const engineFiles = import.meta.glob('../../scripts/engine/**/*.js', { query: '?raw', import: 'default', eager: true })
const sceneFilesAll = import.meta.glob('../../scripts/**/*.js', { query: '?raw', import: 'default', eager: true })
const sceneFiles = Object.fromEntries(Object.entries(sceneFilesAll).filter(([path]) => !path.includes('/engine/')))

const defaultVertPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.vert'))
const defaultFragPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.frag'))
const sceneScriptPath = Object.keys(sceneFiles).find((p) => p.endsWith('scene-script.js'))

function normalizePath(p) {
  return p.replace(/^\.\.\/\.\.\//, '')
}

function buildTree(files, baseDir) {
  const root = { type: 'folder', name: baseDir, path: baseDir, children: [] }

  function addNode(current, parts, fullPath) {
    if (parts.length === 0) return
    const [head, ...tail] = parts
    let child = current.children.find((c) => c.name === head)
    if (!child) {
      child = { type: tail.length ? 'folder' : 'file', name: head, path: tail.length ? `${current.path}/${head}` : fullPath, children: [] }
      current.children.push(child)
    }
    if (tail.length) addNode(child, tail, fullPath)
  }

  Object.keys(files).forEach((filePath) => {
    const normalized = normalizePath(filePath)
    const rel = normalized.startsWith(baseDir) ? normalized.slice(baseDir.length) : normalized
    const parts = rel.split('/').filter(Boolean)
    addNode(root, parts, filePath)
  })

  return root
}

function normalizeText(value) {
  if (value === undefined || value === null) return ''
  return String(value).replace(/\r\n/g, '\n')
}

function CodeEditor({ value, onChange, mode, readOnly }) {
  const hostRef = useRef(null)
  const cmRef = useRef(null)
  const isSettingRef = useRef(false)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!hostRef.current) return

    if (!cmRef.current) {
      cmRef.current = CodeMirror(hostRef.current, {
        value: value || '',
        lineNumbers: true,
        theme: 'dracula',
        mode,
        readOnly: readOnly ? 'nocursor' : false,
        indentUnit: 2,
        tabSize: 2,
        viewportMargin: Infinity,
      })

      cmRef.current.on('change', (cm) => {
        if (isSettingRef.current) return
        if (typeof onChangeRef.current === 'function') {
          onChangeRef.current(cm.getValue())
        }
      })
    } else {
      const cm = cmRef.current
      if (cm.getValue() !== value) {
        isSettingRef.current = true
        cm.setValue(value || '')
        isSettingRef.current = false
      }
      cm.setOption('mode', mode)
      cm.setOption('readOnly', readOnly ? 'nocursor' : false)
    }
  }, [value, mode, readOnly, onChange])

  return <div className="code-editor" ref={hostRef} />
}

export default function App(){
  const [backend, setBackend] = useState('webgl')
  const [error, setError] = useState(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)

  useEffect(()=>{
    let cancelled = false

    async function boot() {
      if (backend !== 'webgl') return
      const canvas = canvasRef.current
      if (!canvas) return

      const engine = await initEngine({
        canvas,
        shaderSources: { vertex: fileContents[defaultVertPath], fragment: fileContents[defaultFragPath] },
        scriptSource: fileContents[sceneScriptPath],
        onError: (err) => {
          if (!cancelled) setError(err?.message || String(err))
        }
      })
      engineRef.current = engine
      // Setup settings and menu handlers once engine is ready and DOM is mounted
      let cleanupMenu = null
      try {
        const settingsMgr = setupSettings((k,v)=>{})
        cleanupMenu = setupMenuHandlers({ gl: engine.gl, scene: engine.scene, settings: settingsMgr, updateScript: () => { applyScript() }, camera: engine.camera })
      } catch (e) {
        // If menu handlers expect DOM elements, they should now be present; log any error.
        console.warn('Menu handlers setup failed:', e)
      }

      // store cleanup so we can remove listeners if the engine reboots
      if (cleanupMenu) {
        // attach to engineRef so cleanup runs on unmount/reset
        engineRef.current && (engineRef.current._cleanupMenu = cleanupMenu)
      }
    }

    boot()

    return () => {
      cancelled = true
      if (engineRef.current && typeof engineRef.current._cleanupMenu === 'function') {
        try { engineRef.current._cleanupMenu() } catch (e) { /* ignore */ }
        delete engineRef.current._cleanupMenu
      }
      engineRef.current = null
    }
  }, [backend])

  // Handlers to apply edits
  function applyShaders() {
    const e = engineRef.current
    if (!e) return setError('Engine not initialized')
    const ok = e.setShaders(fileContents[defaultVertPath], fileContents[defaultFragPath])
    if (!ok) setError('Shader compilation failed')
    else {
      setError(null)
      setLastApplied((prev) => ({
        ...prev,
        [defaultVertPath]: fileContents[defaultVertPath],
        [defaultFragPath]: fileContents[defaultFragPath]
      }))
    }
  }

  function applyScript() {
    const e = engineRef.current
    if (!e) return setError('Engine not initialized')
    const ok = e.setScriptSource(fileContents[sceneScriptPath])
    if (!ok) setError('Script error')
    else {
      setError(null)
      setLastApplied((prev) => ({
        ...prev,
        [sceneScriptPath]: fileContents[sceneScriptPath]
      }))
    }
  }

  const [activeTab, setActiveTab] = useState(sceneScriptPath || '')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [openTabs, setOpenTabs] = useState(() => [sceneScriptPath, defaultVertPath, defaultFragPath].filter(Boolean))

  const fileContentMap = {
    ...shaderFiles,
    ...engineFiles,
    ...sceneFiles
  }

  const editableDefaults = useMemo(() => {
    const defaults = {}
    if (sceneScriptPath) defaults[sceneScriptPath] = defaultScript
    if (defaultVertPath) defaults[defaultVertPath] = defaultVert
    if (defaultFragPath) defaults[defaultFragPath] = defaultFrag
    return defaults
  }, [sceneScriptPath, defaultVertPath, defaultFragPath])

  const [fileContents, setFileContents] = useState(() => ({ ...editableDefaults }))
  const [lastApplied, setLastApplied] = useState(() => ({ ...editableDefaults }))

  useEffect(() => {
    // Ensure editable defaults are present in state when paths resolve
    setFileContents((prev) => {
      const next = { ...prev }
      Object.entries(editableDefaults).forEach(([key, val]) => {
        if (next[key] === undefined) next[key] = val
      })
      return next
    })
    setLastApplied((prev) => {
      const next = { ...prev }
      Object.entries(editableDefaults).forEach(([key, val]) => {
        if (next[key] === undefined) next[key] = val
      })
      return next
    })
  }, [editableDefaults])

  const shaderTree = buildTree(shaderFiles, 'assets/shaders/')
  const engineTree = buildTree(engineFiles, 'scripts/engine/')
  const sceneTree = buildTree(sceneFiles, 'scripts/')

  const [expanded, setExpanded] = useState(() => new Set(['Shaders', 'Engine', 'Scene Files']))

  function toggleExpand(key) {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpanded(next)
  }

  function resolveTabKey(tab) {
    if (!tab) return ''
    if (fileContents[tab] !== undefined || editableDefaults[tab] !== undefined || fileContentMap[tab] !== undefined) return tab
    const candidates = Object.keys({ ...fileContentMap, ...editableDefaults })
    return candidates.find((k) => k.endsWith(`/${tab}`) || k.endsWith(tab)) || tab
  }

  const resolvedActiveTab = resolveTabKey(activeTab)

  useEffect(() => {
    if (!activeTab && sceneScriptPath) setActiveTab(sceneScriptPath)
  }, [activeTab, sceneScriptPath])

  function isEditable(path) {
    return path === sceneScriptPath || path === defaultVertPath || path === defaultFragPath
  }

  const dirtyMap = useMemo(() => {
    const map = {}
    Object.keys(editableDefaults).forEach((path) => {
      const current = normalizeText(fileContents[path] ?? editableDefaults[path])
      const baseline = normalizeText(editableDefaults[path])
      map[path] = current !== baseline
    })
    return map
  }, [fileContents, editableDefaults])

  const unappliedMap = useMemo(() => {
    const map = {}
    Object.keys(editableDefaults).forEach((path) => {
      const current = normalizeText(fileContents[path] ?? editableDefaults[path])
      const applied = normalizeText(lastApplied[path] ?? editableDefaults[path])
      map[path] = current !== applied
    })
    return map
  }, [fileContents, lastApplied, editableDefaults])

  function isDirty(path) {
    if (!isEditable(path)) return false
    return !!dirtyMap[path]
  }

  function hasUnapplied(path) {
    if (!isEditable(path)) return false
    return !!unappliedMap[path]
  }

  function handleApply() {
    if (resolvedActiveTab === defaultVertPath || resolvedActiveTab === defaultFragPath) applyShaders()
    else if (resolvedActiveTab === sceneScriptPath) applyScript()
  }

  function renderEditorTab() {
    if (!resolvedActiveTab) return null

    if (resolvedActiveTab === sceneScriptPath) {
      return (
        <CodeEditor
          value={fileContents[sceneScriptPath]}
          onChange={(val) => setFileContents((prev) => ({ ...prev, [sceneScriptPath]: val }))}
          mode="javascript"
          readOnly={false}
        />
      )
    }
    if (resolvedActiveTab === defaultVertPath) {
      return (
        <CodeEditor
          value={fileContents[defaultVertPath]}
          onChange={(val) => setFileContents((prev) => ({ ...prev, [defaultVertPath]: val }))}
          mode="x-shader/x-vertex"
          readOnly={false}
        />
      )
    }
    if (resolvedActiveTab === defaultFragPath) {
      return (
        <CodeEditor
          value={fileContents[defaultFragPath]}
          onChange={(val) => setFileContents((prev) => ({ ...prev, [defaultFragPath]: val }))}
          mode="x-shader/x-fragment"
          readOnly={false}
        />
      )
    }

    const readOnlyValue = fileContentMap[resolvedActiveTab] || ''
    return (
      <CodeEditor
        value={readOnlyValue}
        onChange={null}
        mode="javascript"
        readOnly={true}
      />
    )
  }

  // Explorer open file
  function openFile(fileId) {
    if (!openTabs.includes(fileId)) setOpenTabs([...openTabs, fileId])
    setActiveTab(fileId)
  }

  // Close tab
  function closeTab(fileId) {
    if (openTabs.length <= 1) return
    const next = openTabs.filter(t => t !== fileId)
    setOpenTabs(next)
    if (activeTab === fileId) setActiveTab(next[0] || '')
  }

  // Reset content for active tab
  function resetActive() {
    if (resolvedActiveTab === sceneScriptPath) setFileContents((prev) => ({ ...prev, [sceneScriptPath]: defaultScript }))
    else if (resolvedActiveTab === defaultVertPath) setFileContents((prev) => ({ ...prev, [defaultVertPath]: defaultVert }))
    else if (resolvedActiveTab === defaultFragPath) setFileContents((prev) => ({ ...prev, [defaultFragPath]: defaultFrag }))
  }

  // Auto-refresh effect: apply changes after debounce when enabled
  useEffect(()=>{
    if (!autoRefresh || !resolvedActiveTab || !hasUnapplied(resolvedActiveTab)) return
    const timer = setTimeout(()=>{
      if (resolvedActiveTab === sceneScriptPath) applyScript()
      else if (resolvedActiveTab === defaultVertPath || resolvedActiveTab === defaultFragPath) applyShaders()
    }, 3000)
    return ()=>clearTimeout(timer)
  }, [fileContents, resolvedActiveTab, autoRefresh])

  function renderTree(node, prefix, groupKey) {
    if (node.type === 'folder') {
      const folderKey = `${groupKey}/${prefix}${node.name}`
      const isRoot = node.name.endsWith('/')
      const isOpen = expanded.has(folderKey) || isRoot

      return (
        <div key={folderKey} className="explorer-folder">
          {!isRoot && (
            <div className="explorer-row" onClick={() => toggleExpand(folderKey)}>
              <span className="caret">{isOpen ? '▾' : '▸'}</span>
              <span className="folder-name">{node.name}</span>
            </div>
          )}
          {isOpen && (
            <div className="explorer-children">
              {node.children.map((child) => renderTree(child, `${prefix}${node.name}/`, groupKey))}
            </div>
          )}
        </div>
      )
    }

    const filePath = node.path
    const fileName = node.name
    return (
      <div key={filePath} className={`explorer-row file ${openTabs.includes(filePath) ? 'opened' : ''}`} onClick={() => openFile(filePath)}>
        <span className="file-name">{fileName}</span>
      </div>
    )
  }

  return (
    <div className="app-root full-ui">
      <div className="topbar">
        <div className="brand">
          <img src={logoPng} alt="logo" className="logo-img" />
          <div className="title">Drishyam3D</div>
        </div>
        <nav className="menu">
          <div id="file-menu-container" className="menu-container">
            <div className="menu-item">File</div>
            <div className="dropdown-content">
              <div className="menu-submenu">
                <div className="menu-item">Import Model</div>
                <div className="dropdown-content sub-dropdown">
                  <a href="#" id="import-zip-btn" title="Load zip containing gltf model">Import .zip</a>
                  <a href="#" id="import-folder-btn" title="Load directory containing gltf model">Import Directory</a>
                </div>
              </div>
              <div className="menu-separator"></div>
              <a href="#" id="load-sample-gltf-btn">Load Sample Model</a>
              <div className="menu-separator"></div>
              <a href="#" id="reset-scene-btn">Reset Scene</a>
            </div>
          </div>

          <div id="shapes-menu-container" className="menu-container">
            <div className="menu-item">Shapes</div>
            <div className="dropdown-content">
              <a href="#" id="shape-textured-toggle" className="menu-checkbox">
                <input type="checkbox" id="shape-textured-checkbox" />
                <label htmlFor="shape-textured-checkbox">Textured</label>
              </a>
              <div className="menu-separator"></div>
              <a href="#" id="shape-cube-btn">Cube</a>
              <a href="#" id="shape-sphere-btn">Sphere</a>
              <div className="menu-separator"></div>
              <a href="#" className="disabled">Cone (soon)</a>
              <a href="#" className="disabled">Cylinder (soon)</a>
              <a href="#" className="disabled">Trapezoid (soon)</a>
            </div>
          </div>

          <div id="settings-menu-container" className="menu-container">
            <div className="menu-item">Settings</div>
            <div className="dropdown-content">
              <a href="#" className="disabled">No settings available</a>
            </div>
          </div>
        </nav>
        <div className="top-controls" />
      </div>

      {error && (
        <div className="error-banner">{error}</div>
      )}

      <div className="content">
        <aside className="left-panel">
          <div className="explorer-title">EXPLORER</div>
          <div className="explorer-group">
            <div className="explorer-row group" onClick={() => toggleExpand('Shaders')}>Shaders</div>
            {expanded.has('Shaders') && renderTree(shaderTree, '', 'Shaders')}
          </div>
          <div className="explorer-group">
            <div className="explorer-row group" onClick={() => toggleExpand('Engine')}>Engine</div>
            {expanded.has('Engine') && renderTree(engineTree, '', 'Engine')}
          </div>
          <div className="explorer-group">
            <div className="explorer-row group" onClick={() => toggleExpand('Scene Files')}>Scene Files</div>
            {expanded.has('Scene Files') && renderTree(sceneTree, '', 'Scene Files')}
          </div>
        </aside>

        <section className="center-panel">
          <div className="viewport-canvas-wrap">
            <canvas ref={canvasRef} className="viewport-canvas" id="glcanvas" />
            <input type="file" id="model-file-input" style={{display:'none'}} accept=".zip,.gltf" multiple />
          </div>
        </section>

        <aside className="right-panel">
          <div className="editor-tabs">
            {openTabs.map(t=> (
              <div key={t} className={`tab ${resolvedActiveTab===resolveTabKey(t)?'active':''} ${isDirty(resolveTabKey(t))?'dirty':''}`} onClick={()=>setActiveTab(t)}>
                <span className="tab-label">{t.split('/').pop()}</span>
                <button className="tab-close" onClick={(e)=>{e.stopPropagation(); closeTab(t)}}>×</button>
              </div>
            ))}
          </div>

          <div className="editor-area">
            <div id="editor-header">
              {/* placeholder for editor tabs header if needed */}
            </div>
            <div id="error-console" style={{display:'none'}}></div>
            {renderEditorTab()}
          </div>

          <div className="editor-footer">
            <label style={{display:'inline-flex',alignItems:'center',gap:8}}>
              <input type="checkbox" checked={autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} /> Auto Refresh
            </label>
            <div style={{marginLeft:'auto',display:'flex',gap:8}}>
              <button onClick={resetActive} disabled={!isEditable(resolvedActiveTab) || !isDirty(resolvedActiveTab)}>Reset</button>
              <button onClick={handleApply} disabled={!isEditable(resolvedActiveTab) || !hasUnapplied(resolvedActiveTab)}>Apply</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
