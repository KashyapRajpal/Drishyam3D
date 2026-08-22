import React, {useState, useRef, useEffect, useMemo, useCallback} from 'react'
import CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/dracula.css'
import 'codemirror/mode/javascript/javascript'
import 'codemirror/mode/clike/clike'
import { initEngine } from '@engine/app-facade.js'
import { initCpuRayEngine } from '@engine/cpu-ray-facade.js'
import { createRayTracingCoordinator } from '@engine/raytracing-coordinator.js'
import { createDefaultCube, createDefaultTexturedCube, createSphere, createTexturedSphere } from '@engine/geometry.js'
import { createWebGPUGeometryFactory } from '@engine/webgpu-facade.js'
import checkerboardTextureUrl from '@assets/checkerboard-texture.png'
import defaultVert from '@assets/shaders/default.vert?raw'
import defaultFrag from '@assets/shaders/default.frag?raw'
import defaultWgsl from '@assets/shaders/default.wgsl?raw'
import splatWgsl from '@assets/shaders/splat.wgsl?raw'
import splatSortWgsl from '@assets/shaders/splat-sort.wgsl?raw'
import blitWgsl from '@assets/shaders/blit.wgsl?raw'
import tileRenderWgsl from '@assets/shaders/splat-tile-render.wgsl?raw'
import splatCullWgsl from '@assets/shaders/splat-cull.wgsl?raw'
import splatRadixWgsl from '@assets/shaders/splat-radix-sort.wgsl?raw'
import raytraceWgsl from '@assets/shaders/raytrace.wgsl?raw'
import hybridGbufferWgsl from '@assets/shaders/hybrid-gbuffer.wgsl?raw'
import hybridCompositeWgsl from '@assets/shaders/hybrid-composite.wgsl?raw'
import hybridShadowWgsl from '@assets/shaders/hybrid-shadow.wgsl?raw'
import defaultScript from '@scripts/scene-script.js?raw'
import logoJpg from '@assets/logo/drishyam3d_logo.jpg'
import { setupSettings } from '@engine/settings.js'
import {
  loadShape,
  resetScene as resetSceneOp,
  loadSampleGltf,
  SAMPLE_GLTF_MODEL,
  loadAssetFiles,
  loadAssetFromDirectory,
} from '@engine/scene-ops.js'
import { ViewportCanvases } from './components/ViewportCanvases.jsx'
import { RayTracingControls } from './components/RayTracingControls.jsx'

const shaderFiles = import.meta.glob('../../assets/shaders/**/*.{vert,frag,glsl,wgsl}', { query: '?raw', import: 'default' })
const engineFiles = import.meta.glob('../../scripts/engine/**/*.js', { query: '?raw', import: 'default' })
const sceneFilesAll = import.meta.glob('../../scripts/**/*.js', { query: '?raw', import: 'default' })
const sceneFiles = Object.fromEntries(Object.entries(sceneFilesAll).filter(([path]) => !path.includes('/engine/')))

const defaultVertPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.vert'))
const defaultFragPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.frag'))
const defaultWgslPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.wgsl'))
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

function formatCount(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString()
}

function StatsOverlay({ stats }) {
  if (!stats) return null
  const isCpuRayTracing = stats.renderMode === 'raytrace-cpu'
  const isGpuRayTracing = stats.renderMode === 'raytrace-gpu'
  const isHybridRayTracing = stats.renderMode === 'hybrid-shadows'
  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      background: 'rgba(0,0,0,0.7)',
      color: '#0f0',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '8px 12px',
      borderRadius: '4px',
      lineHeight: '1.6',
      pointerEvents: 'none',
      zIndex: 1000,
    }}>
      {isCpuRayTracing ? (
        <>
          <div>CPU path tracing · {stats.spp || 0} spp</div>
          <div>{formatCount(stats.raysPerSecond || 0)} rays/s · {(stats.frameMs || 0).toFixed(1)}ms pass</div>
        </>
      ) : isGpuRayTracing ? (
        <>
          <div>GPU path tracing · {stats.spp || 0} spp</div>
          <div>{stats.fps} fps ({stats.frameMs}ms)</div>
        </>
      ) : isHybridRayTracing ? (
        <>
          <div>Hybrid ray-traced shadows</div>
          <div>{stats.fps} fps ({stats.frameMs}ms)</div>
        </>
      ) : <div>{stats.fps} fps ({stats.frameMs}ms)</div>}
      <div>{stats.drawableKind}</div>
      {stats.triangleCount > 0 && <div>{formatCount(stats.triangleCount)} tris</div>}
      {stats.blasBuildMs > 0 && <div style={{ color: '#9cf' }}>BLAS {stats.blasBuildMs.toFixed(2)}ms</div>}
      {stats.tlasBuildMs > 0 && <div style={{ color: '#9cf' }}>TLAS {stats.tlasBuildMs.toFixed(2)}ms</div>}
      {isHybridRayTracing && stats.passMs?.gbuffer != null && <div style={{ color: '#fc6' }}>G-buffer {stats.passMs.gbuffer.toFixed(2)}ms</div>}
      {isHybridRayTracing && stats.passMs?.shadow != null && <div style={{ color: '#fc6' }}>shadow {stats.passMs.shadow.toFixed(2)}ms</div>}
      {isHybridRayTracing && stats.passMs?.composite != null && <div style={{ color: '#fc6' }}>composite {stats.passMs.composite.toFixed(2)}ms</div>}
      {stats.splatCount > 0 && <div>{formatCount(stats.splatCount)} splats</div>}
      {stats.splatCount > 0 && stats.reductionMode === 'culled' && (
        <div style={{ color: '#6cf' }}>
          {formatCount(stats.visibleSplats)} vis · {Math.round((1 - stats.visibleSplats / stats.splatCount) * 100)}% culled
        </div>
      )}
      {stats.passMs?.reduce != null && <div style={{ color: '#fc6' }}>reduce {stats.passMs.reduce.toFixed(2)}ms</div>}
      {/* GpuTimer withholds stale readings, so a missing value means "no recent
          sample" — show a dash rather than dropping the line, which would read as
          "this pass stopped running". */}
      {stats.splatCount > 0 && (
        <div style={{ color: '#fc6' }}>
          sort ({stats.sortMode}) {stats.passMs?.sort != null ? `${stats.passMs.sort.toFixed(2)}ms` : '—'}
        </div>
      )}
      {stats.splatCount > 0 && (
        <div style={{ color: '#fc6' }}>
          render {stats.passMs?.render != null ? `${stats.passMs.render.toFixed(2)}ms` : '—'}
        </div>
      )}
    </div>
  )
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
  // Visual-regression harness loads with ?test=1 and drives WebGPU splats directly.
  const isVisualTest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test')
  const [backend, setBackend] = useState(isVisualTest ? 'webgpu' : 'webgl')
  const [renderMode, setRenderMode] = useState('raster')
  const [hasRayScene, setHasRayScene] = useState(false)
  const [hasHybridScene, setHasHybridScene] = useState(false)
  const [rayPaused, setRayPaused] = useState(false)
  const [error, setError] = useState(null)
  const [textured, setTextured] = useState(false)
  const [currentShape, setCurrentShape] = useState('cube')
  const [hasModelLoaded, setHasModelLoaded] = useState(false)
  const [splatLoaded, setSplatLoaded] = useState(false)
  const [splatDebug, setSplatDebug] = useState('off') // 'off' | 'points'
  const [shDegree, setShDegree] = useState(3) // max SH degree used for splat shading
  const [splatRenderMode, setSplatRenderMode] = useState('instanced') // 'instanced' | 'tile'
  const [splatSort, setSplatSort] = useState('bitonic') // ordering matrix — sort axis
  const [splatReduction, setSplatReduction] = useState('none') // ordering matrix — reduction axis
  const [flipSplatY, setFlipSplatY] = useState(true) // reflect splat cloud about XZ plane (most captures are y-down)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState(null)
  const [engineReady, setEngineReady] = useState(0)
  const canvasRef = useRef(null)
  const cpuCanvasRef = useRef(null)
  const engineRef = useRef(null)
  const rayCoordinatorRef = useRef(null)
  const geometryFactoryRef = useRef(null)
  const pickerActiveRef = useRef(false)
  const pendingSampleLoadRef = useRef(false)

  useEffect(() => {
    if (!cpuCanvasRef.current) return
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: cpuCanvasRef.current,
      cpuFactory: initCpuRayEngine,
      onModeChange: setRenderMode,
      onError: (err) => setError(err?.message || String(err)),
    })
    rayCoordinatorRef.current = coordinator
    if (engineRef.current) coordinator.setRasterEngine(engineRef.current)
    const handleResize = () => coordinator.resize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      coordinator.destroy()
      if (rayCoordinatorRef.current === coordinator) rayCoordinatorRef.current = null
    }
  }, [])

  useEffect(()=>{
    let cancelled = false

    async function boot() {
      const canvas = canvasRef.current
      if (!canvas) return

      const shaderSources = backend === 'webgpu'
        ? {
            wgsl: fileContents[defaultWgslPath] ?? defaultWgsl,
            splatWgsl,
            splatSortWgsl,
            blitWgsl,
            tileRenderWgsl,
            splatCullWgsl,
            splatRadixWgsl,
            raytraceWgsl,
            hybridGbufferWgsl,
            hybridCompositeWgsl,
            hybridShadowWgsl,
          }
        : { vertex: fileContents[defaultVertPath], fragment: fileContents[defaultFragPath] }

      const engine = await initEngine({
        canvas,
        backend,
        shaderSources,
        scriptSource: fileContents[sceneScriptPath],
        onError: (err) => {
          if (!cancelled) setError(err?.message || String(err))
        }
      })
      if (cancelled) {
        if (engine && typeof engine.destroy === 'function') {
          try { engine.destroy() } catch (e) { /* ignore */ }
        }
        return
      }
      engineRef.current = engine
      rayCoordinatorRef.current?.setRasterEngine(engine)

      // Expose test surfaces only for the visual-regression harness. The ray
      // helper is dynamically imported so its CPU oracle stays out of normal loads.
      if (isVisualTest) {
        const { createRayVisualTestApi } = await import('@engine/raytracing/visual-test-api.js')
        if (cancelled) return
        window.__DRISHYAM_ENGINE = engine
        window.__DRISHYAM_RAY_TEST = createRayVisualTestApi({
          engine,
          coordinator: rayCoordinatorRef.current,
        })
      }

      setupSettings((k,v)=>{})
      geometryFactoryRef.current = backend === 'webgpu'
        ? createWebGPUGeometryFactory(engine.device, checkerboardTextureUrl)
        : {
            createCube: () => createDefaultCube(engine.gl),
            createTexturedCube: () => createDefaultTexturedCube(engine.gl, checkerboardTextureUrl),
            createSphere: () => createSphere(engine.gl),
            createTexturedSphere: () => createTexturedSphere(engine.gl, checkerboardTextureUrl),
          }

      setEngineReady((n) => n + 1)
    }

    boot()

    return () => {
      cancelled = true
      if (engineRef.current) {
        if (typeof engineRef.current.destroy === 'function') {
          try { engineRef.current.destroy() } catch (e) { /* ignore */ }
        }
        engineRef.current = null
      }
      if (isVisualTest) {
        delete window.__DRISHYAM_ENGINE
        delete window.__DRISHYAM_RAY_TEST
      }
      rayCoordinatorRef.current?.setRasterEngine(null)
      geometryFactoryRef.current = null
    }
  }, [backend])

  // Reset menu state when the backend changes (new engine, fresh UI)
  useEffect(() => {
    setHasModelLoaded(false)
    // The built-in watch is a multi-primitive ray-tracing sample. When its menu
    // action moves the app from WebGL to WebGPU, leave the procedural cube out
    // of the new engine so it cannot race and overwrite the pending watch load.
    setCurrentShape(pendingSampleLoadRef.current ? null : 'cube')
    setTextured(false)
    setSplatLoaded(false)
    setSplatDebug('off')
    setShDegree(3)
    setSplatRenderMode('instanced')
    setSplatSort('bitonic')
    setSplatReduction('none')
    setFlipSplatY(true)
    setHasRayScene(false)
    setHasHybridScene(false)
    setRayPaused(false)
  }, [backend])

  // Apply the splat debug mode to the active engine.
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatDebugMode === 'function') {
      engine.setSplatDebugMode(splatDebug)
    }
  }, [engineReady, splatDebug, splatLoaded])

  // Apply the SH degree cap to the active engine.
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatShDegree === 'function') {
      engine.setSplatShDegree(shDegree)
    }
  }, [engineReady, shDegree, splatLoaded])

  // Apply the splat render mode to the active engine.
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatRenderMode === 'function') {
      engine.setSplatRenderMode(splatRenderMode)
    }
  }, [engineReady, splatRenderMode, splatLoaded])

  // Apply the ordering sort axis to the active engine.
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatSort === 'function') {
      engine.setSplatSort(splatSort)
    }
  }, [engineReady, splatSort, splatLoaded])

  // Apply the ordering reduction axis to the active engine.
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatReduction === 'function') {
      engine.setSplatReduction(splatReduction)
    }
  }, [engineReady, splatReduction, splatLoaded])

  // Apply the Y-flip toggle to the active splat cloud (re-packs in place, no re-parse).
  useEffect(() => {
    if (!engineReady) return
    const engine = engineRef.current
    if (engine && typeof engine.setSplatFlipY === 'function') {
      // Fire-and-forget: re-packs off-thread; surface failures without unhandled rejections.
      Promise.resolve(engine.setSplatFlipY(flipSplatY)).catch((err) => console.error('setSplatFlipY failed', err))
    }
  }, [engineReady, flipSplatY, splatLoaded])

  // Poll stats when visible.
  useEffect(() => {
    if (!showStats || !engineReady) return
    const engine = renderMode === 'raytrace-cpu' ? rayCoordinatorRef.current : engineRef.current
    const timer = setInterval(() => {
      if (engine && typeof engine.getStats === 'function') {
        setStats(engine.getStats())
      }
    }, 200)
    return () => clearInterval(timer)
  }, [showStats, engineReady, renderMode])

  // Drive the current shape from React state. Reacts to shape/textured/engine changes.
  useEffect(() => {
    if (!engineReady || hasModelLoaded || !currentShape) return
    const engine = engineRef.current
    const geometryFactory = geometryFactoryRef.current
    if (!engine || !geometryFactory) return
    let cancelled = false
    loadShape({ engine, geometryFactory, shape: currentShape, textured })
      .then(async () => {
        if (cancelled) return
        await rayCoordinatorRef.current?.setSceneAsset(null)
        setHasRayScene(false)
        setHasHybridScene(false)
        setError(null)
      })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)) })
    return () => { cancelled = true }
  }, [engineReady, currentShape, textured, hasModelLoaded])

  // A backend change starts the WebGPU engine asynchronously. Key this effect
  // only to engineReady so it cannot consume the request during the intervening
  // render where `backend` changed but the new engine has not finished booting.
  useEffect(() => {
    if (!engineReady || backend !== 'webgpu' || !pendingSampleLoadRef.current) return
    pendingSampleLoadRef.current = false
    void loadBuiltInSample()
  }, [engineReady])

  // --- File menu handlers ---
  async function loadBuiltInSample() {
    const engine = engineRef.current
    if (!engine) return
    try {
      await rayCoordinatorRef.current?.setRenderMode('raster')
      const drawable = await loadSampleGltf({ engine })
      await rayCoordinatorRef.current?.setSceneAsset(drawable)
      setHasRayScene(true)
      setHasHybridScene(true)
      setHasModelLoaded(true)
      setCurrentShape(null)
      setError(null)
    } catch (err) {
      setCurrentShape('cube')
      setError(`Sample GLTF Error: ${err?.message || String(err)}`)
    }
  }

  async function handleLoadSample(e) {
    e.preventDefault()
    if (backend !== 'webgpu') {
      pendingSampleLoadRef.current = true
      setError(null)
      setBackend('webgpu')
      return
    }
    await loadBuiltInSample()
  }

  // Unified asset load: pick the folder containing the model — the loader finds
  // the .gltf/.ply inside, auto-loads its companion files (.bin, textures), and
  // infers splat / mesh / glTF. A single-file pick can't read sibling files, so a
  // directory grant is what makes companion auto-loading possible.
  async function handleLoadAsset(e) {
    e.preventDefault()
    const engine = engineRef.current
    if (!engine) return
    if (pickerActiveRef.current || window.__DRISHYAM_PICKER_ACTIVE) return
    pickerActiveRef.current = true
    window.__DRISHYAM_PICKER_ACTIVE = true
    try {
      await rayCoordinatorRef.current?.setRenderMode('raster')
      let kind
      let drawable
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker()
        ;({ kind, drawable } = await loadAssetFromDirectory({ engine, dirHandle, flipY: flipSplatY }))
      } else {
        // Fallback (no directory API): multi-select the model + its companions.
        const isWebGPU = backend === 'webgpu'
        const input = document.querySelector('#model-file-input')
        input.accept = isWebGPU ? '.ply,.gltf,.bin,image/*' : '.gltf,.bin,image/*'
        input.multiple = true
        const files = await new Promise((resolve) => {
          input.onchange = () => resolve(Array.from(input.files || []))
          input.click()
        })
        if (!files?.length) return
        ;({ kind, drawable } = await loadAssetFiles({ engine, files, flipY: flipSplatY }))
      }
      const rayTraceable = !!drawable?.rayTracing
      await rayCoordinatorRef.current?.setSceneAsset(rayTraceable ? drawable : null)
      setHasRayScene(rayTraceable)
      setHasHybridScene(rayTraceable)
      setSplatLoaded(kind === 'splat')
      setHasModelLoaded(true)
      setError(null)
    } catch (err) {
      if (err?.name !== 'AbortError') setError(`Load Asset Error: ${err?.message || String(err)}`)
    } finally {
      pickerActiveRef.current = false
      window.__DRISHYAM_PICKER_ACTIVE = false
    }
  }

  async function handleResetScene(e) {
    e.preventDefault()
    const engine = engineRef.current
    const geometryFactory = geometryFactoryRef.current
    if (!engine || !geometryFactory) return
    try {
      await rayCoordinatorRef.current?.setRenderMode('raster')
      await resetSceneOp({ engine, geometryFactory })
      await rayCoordinatorRef.current?.setSceneAsset(null)
      setHasRayScene(false)
      setHasHybridScene(false)
      setHasModelLoaded(false)
      setCurrentShape('cube')
      setTextured(false)
      setSplatLoaded(false)
      setSplatDebug('off')
      setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  function selectShape(e, shape) {
    e.preventDefault()
    if (hasModelLoaded) return
    setCurrentShape(shape)
  }

  async function handleCornellBox(e) {
    e.preventDefault()
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      await coordinator.loadCornellBox()
      await coordinator.setRenderMode('raytrace-cpu')
      setHasModelLoaded(true)
      setSplatLoaded(false)
      setCurrentShape(null)
      setHasRayScene(true)
      setHasHybridScene(false)
      setRayPaused(false)
      setError(null)
    } catch (err) {
      setError(`CPU Ray Tracing Error: ${err?.message || String(err)}`)
    }
  }

  async function handleGpuCornellBox(e) {
    e.preventDefault()
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      if (backend !== 'webgpu') throw new Error('Switch to WebGPU before starting GPU ray tracing.')
      await coordinator.loadCornellBox('raytrace-gpu')
      await coordinator.setRenderMode('raytrace-gpu')
      setHasModelLoaded(true)
      setSplatLoaded(false)
      setCurrentShape(null)
      setHasRayScene(true)
      setHasHybridScene(false)
      setRayPaused(false)
      setError(null)
    } catch (err) {
      setError(`GPU Ray Tracing Error: ${err?.message || String(err)}`)
    }
  }

  async function selectRasterBackend(e, nextBackend) {
    e.preventDefault()
    try {
      await rayCoordinatorRef.current?.setRenderMode('raster')
      setBackend(nextBackend)
      setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  async function selectRayRenderMode(nextMode) {
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      await coordinator.setRenderMode(nextMode)
      setRayPaused(false)
      setError(null)
    } catch (err) {
      setError(`Ray Tracing Error: ${err?.message || String(err)}`)
    }
  }

  function toggleRayPause() {
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    if (rayPaused) coordinator.resume()
    else coordinator.pause()
    setRayPaused((value) => !value)
  }

  function resetRayAccumulation() {
    rayCoordinatorRef.current?.resetAccumulation()
  }

  // Handlers to apply edits
  function applyShaders() {
    const e = engineRef.current
    if (!e) return setError('Engine not initialized')
    const ok = backend === 'webgpu'
      ? e.setShaders(fileContents[defaultWgslPath] ?? defaultWgsl)
      : e.setShaders(fileContents[defaultVertPath], fileContents[defaultFragPath])
    if (!ok) setError('Shader compilation failed')
    else {
      setError(null)
      if (backend === 'webgpu') {
        setLastApplied((prev) => ({ ...prev, [defaultWgslPath]: fileContents[defaultWgslPath] }))
      } else {
        setLastApplied((prev) => ({
          ...prev,
          [defaultVertPath]: fileContents[defaultVertPath],
          [defaultFragPath]: fileContents[defaultFragPath]
        }))
      }
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
  const [openTabs, setOpenTabs] = useState(() => [sceneScriptPath, defaultVertPath, defaultFragPath, defaultWgslPath].filter(Boolean))

  const fileContentMap = {
    ...shaderFiles,
    ...engineFiles,
    ...sceneFiles
  }

  const loadFileContent = useCallback(async (path) => {
    const fileLoader = fileContentMap[path]
    if (!fileLoader) return ''
    if (typeof fileLoader === 'string') return fileLoader
    if (typeof fileLoader === 'function') return await fileLoader()
    return ''
  }, [fileContentMap])

  const editableDefaults = useMemo(() => {
    const defaults = {}
    if (sceneScriptPath) defaults[sceneScriptPath] = defaultScript
    if (defaultVertPath) defaults[defaultVertPath] = defaultVert
    if (defaultFragPath) defaults[defaultFragPath] = defaultFrag
    if (defaultWgslPath) defaults[defaultWgslPath] = defaultWgsl
    return defaults
  }, [sceneScriptPath, defaultVertPath, defaultFragPath, defaultWgslPath])

  const [fileContents, setFileContents] = useState(() => ({ ...editableDefaults }))
  const [lastApplied, setLastApplied] = useState(() => ({ ...editableDefaults }))
  const [readOnlyContent, setReadOnlyContent] = useState('')

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

  // Only show shader files relevant to the active backend
  const visibleShaderFiles = useMemo(() => {
    return Object.fromEntries(
      Object.entries(shaderFiles).filter(([path]) => {
        if (backend === 'webgpu') return path.endsWith('.wgsl')
        return path.endsWith('.vert') || path.endsWith('.frag') || path.endsWith('.glsl')
      })
    )
  }, [backend])

  const shaderTree = buildTree(visibleShaderFiles, 'assets/shaders/')
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
    if (!resolvedActiveTab) {
      setReadOnlyContent('')
      return
    }
    const isEditableFile = editableDefaults.hasOwnProperty(resolvedActiveTab)
    if (isEditableFile) return
    loadFileContent(resolvedActiveTab).then(setReadOnlyContent).catch(() => setReadOnlyContent(''))
  }, [resolvedActiveTab, editableDefaults, loadFileContent])

  useEffect(() => {
    if (!activeTab && sceneScriptPath) setActiveTab(sceneScriptPath)
  }, [activeTab, sceneScriptPath])

  function isEditable(path) {
    return path === sceneScriptPath || path === defaultVertPath || path === defaultFragPath || path === defaultWgslPath
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
    if (resolvedActiveTab === defaultWgslPath) applyShaders()
    else if (resolvedActiveTab === defaultVertPath || resolvedActiveTab === defaultFragPath) applyShaders()
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
    if (resolvedActiveTab === defaultWgslPath) {
      return (
        <CodeEditor
          value={fileContents[defaultWgslPath]}
          onChange={(val) => setFileContents((prev) => ({ ...prev, [defaultWgslPath]: val }))}
          mode="javascript"
          readOnly={false}
        />
      )
    }

    return (
      <CodeEditor
        value={readOnlyContent}
        onChange={null}
        mode="javascript"
        readOnly={true}
      />
    )
  }

  function isRelevantFile(path) {
    if (path.endsWith('.vert') || path.endsWith('.frag') || path.endsWith('.glsl')) return backend === 'webgl'
    if (path.endsWith('.wgsl')) return backend === 'webgpu'
    return true
  }

  // Close irrelevant shader tabs whenever the backend changes
  useEffect(() => {
    setOpenTabs((prev) => {
      const next = prev.filter(isRelevantFile)
      return next.length > 0 ? next : [sceneScriptPath].filter(Boolean)
    })
    setActiveTab((prev) => (isRelevantFile(prev) ? prev : sceneScriptPath || ''))
  }, [backend])

  // Explorer open file
  function openFile(fileId) {
    if (!isRelevantFile(fileId)) return
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
    else if (resolvedActiveTab === defaultWgslPath) setFileContents((prev) => ({ ...prev, [defaultWgslPath]: defaultWgsl }))
  }

  // Auto-refresh effect: apply changes after debounce when enabled
  useEffect(()=>{
    if (!autoRefresh || !resolvedActiveTab || !hasUnapplied(resolvedActiveTab)) return
    const timer = setTimeout(()=>{
      if (resolvedActiveTab === sceneScriptPath) applyScript()
      else if (resolvedActiveTab === defaultVertPath || resolvedActiveTab === defaultFragPath || resolvedActiveTab === defaultWgslPath) applyShaders()
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
            <div className="explorer-row" onClick={() => toggleExpand(folderKey)} role="treeitem" tabIndex="0" aria-expanded={isOpen} aria-label={`${node.name} folder`}>
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
      <div key={filePath} className={`explorer-row file ${openTabs.includes(filePath) ? 'opened' : ''}`} onClick={() => openFile(filePath)} role="button" tabIndex="0" aria-label={`Open ${fileName}`}>
        <span className="file-name">{fileName}</span>
      </div>
    )
  }

  return (
    <div className="app-root full-ui">
      <div className="topbar">
        <div className="brand">
          <img src={logoJpg} alt="Drishyam3D logo" className="logo-img" />
          <div className="title">Drishyam3D</div>
        </div>
        <nav className="menu">
          <div id="file-menu-container" className="menu-container">
            <div className="menu-item" role="button" tabIndex="0" aria-label="File menu">File</div>
            <div className="dropdown-content">
              <a
                href="#"
                onClick={handleLoadSample}
                title={`${SAMPLE_GLTF_MODEL.name} by ${SAMPLE_GLTF_MODEL.creator} · ${SAMPLE_GLTF_MODEL.license} · switches to WebGPU when needed`}
              >Load {SAMPLE_GLTF_MODEL.name} ({SAMPLE_GLTF_MODEL.license})</a>
              <a href="#" onClick={handleLoadAsset} title={backend === 'webgpu'
                ? "Select the model's folder — the .gltf or .ply inside loads with its .bin/textures automatically (splat vs mesh detected)."
                : "Select the model's folder — the .gltf inside loads with its .bin/textures. (Switch to WebGPU for .ply splats/meshes.)"}>Load Asset…</a>
              <div className="menu-separator"></div>
              <a href="#" onClick={handleResetScene}>Reset Scene</a>
            </div>
          </div>

          <div id="examples-menu-container" className="menu-container">
            <div className="menu-item" role="button" tabIndex="0" aria-label="Examples menu">Examples</div>
            <div className="dropdown-content">
              <a href="#" style={renderMode === 'raytrace-cpu' ? {fontWeight:'bold'} : {}} onClick={handleCornellBox}>Cornell Box · CPU</a>
              <a href="#" className={backend !== 'webgpu' ? 'disabled' : ''} style={renderMode === 'raytrace-gpu' ? {fontWeight:'bold'} : {}} onClick={handleGpuCornellBox}>Cornell Box · GPU</a>
            </div>
          </div>

          <div id="shapes-menu-container" className={`menu-container ${hasModelLoaded ? 'disabled' : ''}`}>
            <div className="menu-item" role="button" tabIndex="0" aria-label="Shapes menu">Shapes</div>
            <div className="dropdown-content">
              <a href="#" className="menu-checkbox" onClick={(e) => { e.preventDefault(); if (!hasModelLoaded) setTextured(v => !v) }}>
                <input type="checkbox" checked={textured} onChange={() => {}} disabled={hasModelLoaded} style={{pointerEvents:'none'}} />
                <label style={textured ? {fontWeight:'bold'} : {}}>Textured</label>
              </a>
              <div className="menu-separator"></div>
              <a href="#" style={currentShape === 'cube' && !hasModelLoaded ? {fontWeight:'bold'} : {}} onClick={(e) => selectShape(e, 'cube')}>Cube</a>
              <a href="#" style={currentShape === 'sphere' && !hasModelLoaded ? {fontWeight:'bold'} : {}} onClick={(e) => selectShape(e, 'sphere')}>Sphere</a>
              <div className="menu-separator"></div>
              <a href="#" className="disabled">Cone (soon)</a>
              <a href="#" className="disabled">Cylinder (soon)</a>
              <a href="#" className="disabled">Trapezoid (soon)</a>
            </div>
          </div>

          <div id="settings-menu-container" className="menu-container">
            <div className="menu-item" role="button" tabIndex="0" aria-label="Settings menu">Settings</div>
            <div className="dropdown-content">
              <div className="menu-label" style={{padding:'4px 12px',opacity:0.6,fontSize:'0.8em',userSelect:'none'}}>Raster Backend</div>
              <a href="#" style={backend === 'webgl' && renderMode === 'raster' ? {fontWeight:'bold'} : {}} onClick={(e) => selectRasterBackend(e, 'webgl')}>WebGL</a>
              <a href="#" style={backend === 'webgpu' && renderMode === 'raster' ? {fontWeight:'bold'} : {}} onClick={(e) => selectRasterBackend(e, 'webgpu')}>WebGPU</a>
              <div className="menu-separator"></div>
              <RayTracingControls
                backend={backend}
                renderMode={renderMode}
                hasRayScene={hasRayScene}
                hasHybridScene={hasHybridScene}
                capabilities={rayCoordinatorRef.current?.getCapabilities?.() || {}}
                paused={rayPaused}
                onSelectMode={selectRayRenderMode}
                onTogglePause={toggleRayPause}
                onResetAccumulation={resetRayAccumulation}
              />
              {splatLoaded && (
                <>
                  <div className="menu-separator"></div>
                  <div className="menu-label" style={{padding:'4px 12px',opacity:0.6,fontSize:'0.8em',userSelect:'none'}}>Splat Ordering</div>
                  {[
                    { axis: 'Sort', value: splatSort, set: setSplatSort, opts: [
                        { k: 'bitonic', l: 'Bitonic' },
                        { k: 'radix', l: 'Radix' },
                    ] },
                    { axis: 'Reduction', value: splatReduction, set: setSplatReduction, opts: [
                        { k: 'none', l: 'None' },
                        { k: 'culled', l: 'Culled' },
                        { k: 'coarse', l: 'Coarse', soon: true },
                        { k: 'lod', l: 'LOD', soon: true },
                    ] },
                    { axis: 'Render', value: splatRenderMode, set: setSplatRenderMode, opts: [
                        { k: 'instanced', l: 'Instanced' },
                        { k: 'tile', l: 'Tile' },
                    ] },
                  ].map((row) => (
                    <div key={row.axis} style={{display:'flex',alignItems:'center',gap:8,padding:'2px 12px'}}>
                      <span style={{width:70,flexShrink:0,fontSize:'0.78em',opacity:0.6,userSelect:'none'}}>{row.axis}</span>
                      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                        {row.opts.map((o) => o.soon ? (
                          <span key={o.k} title="Coming soon" style={{display:'inline-block',padding:'1px 6px',fontSize:'0.85em',opacity:0.35,cursor:'default'}}>{o.l}</span>
                        ) : (
                          <a
                            key={o.k}
                            href="#"
                            style={{display:'inline-block',padding:'1px 6px',fontSize:'0.85em',borderRadius:3,fontWeight: row.value===o.k?'bold':'normal',background: row.value===o.k?'rgba(120,160,255,0.18)':'transparent'}}
                            onClick={(e) => { e.preventDefault(); row.set(o.k) }}
                          >{o.l}</a>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="menu-separator"></div>
                  <div className="menu-label" style={{padding:'4px 12px',opacity:0.6,fontSize:'0.8em',userSelect:'none'}}>Splat Debug</div>
                  <a href="#" style={splatDebug === 'off' ? {fontWeight:'bold'} : {}} onClick={(e) => { e.preventDefault(); setSplatDebug('off') }}>Off</a>
                  <a href="#" style={splatDebug === 'points' ? {fontWeight:'bold'} : {}} onClick={(e) => { e.preventDefault(); setSplatDebug('points') }}>Points</a>
                  <div className="menu-separator"></div>
                  <div className="menu-label" style={{padding:'4px 12px',opacity:0.6,fontSize:'0.8em',userSelect:'none'}}>SH Degree</div>
                  {[0, 1, 2, 3].map((d) => (
                    <a
                      key={d}
                      href="#"
                      style={shDegree === d ? {fontWeight:'bold'} : {}}
                      title={d === 0 ? 'Flat DC colour (no view-dependent shading)' : `Spherical harmonics up to degree ${d}`}
                      onClick={(e) => { e.preventDefault(); setShDegree(d) }}
                    >{d === 0 ? '0 (flat)' : String(d)}</a>
                  ))}
                  <div className="menu-separator"></div>
                  <div className="menu-label" style={{padding:'4px 12px',opacity:0.6,fontSize:'0.8em',userSelect:'none'}}>Orientation</div>
                  <a href="#" className="menu-checkbox" title="Reflect the cloud about the XZ plane (most captures are stored y-down)" onClick={(e) => { e.preventDefault(); setFlipSplatY(v => !v) }}>
                    <input type="checkbox" checked={flipSplatY} onChange={() => {}} style={{pointerEvents:'none'}} />
                    <label style={flipSplatY ? {fontWeight:'bold'} : {}}>Flip Y</label>
                  </a>
                </>
              )}
              <div className="menu-separator"></div>
              <a href="#" className="menu-checkbox" onClick={(e) => { e.preventDefault(); setShowStats(v => !v) }}>
                <input type="checkbox" checked={showStats} onChange={() => {}} style={{pointerEvents:'none'}} />
                <label style={showStats ? {fontWeight:'bold'} : {}}>Show Stats</label>
              </a>
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
          <ViewportCanvases rasterCanvasRef={canvasRef} cpuCanvasRef={cpuCanvasRef} rasterKey={backend} renderMode={renderMode}>
            <StatsOverlay stats={showStats ? stats : null} />
            <input type="file" id="model-file-input" style={{display:'none'}} accept=".zip,.gltf" multiple />
          </ViewportCanvases>
        </section>

        <aside className="right-panel">
          <div className="editor-tabs">
            {openTabs.map(t=> (
              <div key={t} className={`tab ${resolvedActiveTab===resolveTabKey(t)?'active':''} ${isDirty(resolveTabKey(t))?'dirty':''}`} onClick={()=>setActiveTab(t)}>
                <span className="tab-label">{t.split('/').pop()}</span>
                <button className="tab-close" onClick={(e)=>{e.stopPropagation(); closeTab(t)}} aria-label={`Close ${t.split('/').pop()}`}>×</button>
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
            <label htmlFor="auto-refresh-checkbox" style={{display:'inline-flex',alignItems:'center',gap:8}}>
              <input id="auto-refresh-checkbox" type="checkbox" checked={autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} /> Auto Refresh
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
