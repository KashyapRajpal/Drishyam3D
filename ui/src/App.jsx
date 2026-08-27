import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { initEngine } from '@engine/app-facade.js'
import { initCpuRayEngine } from '@engine/cpu-ray-facade.js'
import { createCpuRayWorker } from '@engine/raytracing/cpu/cpu-ray-worker-client.js'
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
  loadAssetFiles,
  loadAssetFromDirectory,
} from '@engine/scene-ops.js'
import {
  DEFAULT_RAY_TRACING_SETTINGS,
  mergeRayTracingSettings,
  DEFAULT_HYBRID_LIGHT,
  mergeHybridLight,
} from './ray-control-state.js'
import { openTextFile, saveTextFile } from './lib/fileAccess.js'
import { ViewportCanvases } from './components/ViewportCanvases.jsx'
import { RayTracingControls } from './components/RayTracingControls.jsx'
import { FloatingControlBar } from './components/FloatingControlBar.jsx'
import { TopMenuBar } from './components/TopMenuBar.jsx'
import { FileExplorer } from './components/FileExplorer.jsx'
import { CodeEditorPanel } from './components/CodeEditorPanel.jsx'
import { StatsOverlay } from './components/StatsOverlay.jsx'
import { CommandPalette } from './components/CommandPalette.jsx'
import { ShortcutsModal } from './components/ShortcutsModal.jsx'
import { MinimalLegend } from './components/MinimalLegend.jsx'

const shaderFiles = import.meta.glob('../../assets/shaders/**/*.{vert,frag,glsl,wgsl}', { query: '?raw', import: 'default' })
const engineFiles = import.meta.glob('../../scripts/engine/**/*.js', { query: '?raw', import: 'default' })
const sceneFilesAll = import.meta.glob('../../scripts/**/*.js', { query: '?raw', import: 'default' })
const sceneFiles = Object.fromEntries(Object.entries(sceneFilesAll).filter(([path]) => !path.includes('/engine/')))

const defaultVertPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.vert'))
const defaultFragPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.frag'))
const defaultWgslPath = Object.keys(shaderFiles).find((p) => p.endsWith('default.wgsl'))
const sceneScriptPath = Object.keys(sceneFiles).find((p) => p.endsWith('scene-script.js'))

function initBundledCpuRayEngine(options) {
  return initCpuRayEngine({ ...options, workerFactory: createCpuRayWorker })
}

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

export default function App() {
  const isVisualTest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test')
  const [backend, setBackend] = useState(isVisualTest ? 'webgpu' : 'webgl')
  const [renderMode, setRenderMode] = useState('raster')
  const [uiMode, setUiMode] = useState('view')
  const [showExplorer, setShowExplorer] = useState(true)
  const [showEditorPanel, setShowEditorPanel] = useState(true)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [hasRayScene, setHasRayScene] = useState(false)
  const [hasHybridScene, setHasHybridScene] = useState(false)
  const [rayPaused, setRayPaused] = useState(false)
  const [raySettings, setRaySettings] = useState(() => mergeRayTracingSettings(DEFAULT_RAY_TRACING_SETTINGS))
  const [hybridLight, setHybridLight] = useState(() => mergeHybridLight(DEFAULT_HYBRID_LIGHT))
  const [error, setError] = useState(null)
  const [textured, setTextured] = useState(false)
  const [currentShape, setCurrentShape] = useState('cube')
  const [hasModelLoaded, setHasModelLoaded] = useState(false)
  const [splatLoaded, setSplatLoaded] = useState(false)
  const [splatDebug, setSplatDebug] = useState('off')
  const [shDegree, setShDegree] = useState(3)
  const [splatRenderMode, setSplatRenderMode] = useState('instanced')
  const [splatSort, setSplatSort] = useState('bitonic')
  const [splatReduction, setSplatReduction] = useState('none')
  const [flipSplatY, setFlipSplatY] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState(null)
  const [engineReady, setEngineReady] = useState(0)

  const canvasRef = useRef(null)
  const cpuCanvasRef = useRef(null)
  const engineRef = useRef(null)
  const rayCoordinatorRef = useRef(null)
  const geometryFactoryRef = useRef(null)
  const pickerActiveRef = useRef(false)
  const pendingActionRef = useRef(null)

  const [openFiles, setOpenFiles] = useState(() => [
    { path: sceneScriptPath, name: 'scene-script.js', role: 'script', isDirty: false, handle: null },
    { path: defaultWgslPath, name: 'default.wgsl', role: 'wgsl', isDirty: false, handle: null },
    { path: defaultVertPath, name: 'default.vert', role: 'vert', isDirty: false, handle: null },
    { path: defaultFragPath, name: 'default.frag', role: 'frag', isDirty: false, handle: null },
  ].filter((f) => f.path))
  const [activeTabPath, setActiveTabPath] = useState(sceneScriptPath || '')
  const [autoRefresh, setAutoRefresh] = useState(false)

  const editableDefaults = useMemo(() => {
    const defaults = {}
    if (sceneScriptPath) defaults[sceneScriptPath] = defaultScript
    if (defaultVertPath) defaults[defaultVertPath] = defaultVert
    if (defaultFragPath) defaults[defaultFragPath] = defaultFrag
    if (defaultWgslPath) defaults[defaultWgslPath] = defaultWgsl
    return defaults
  }, [sceneScriptPath, defaultVertPath, defaultFragPath, defaultWgslPath])

  const [fileContents, setFileContents] = useState(() => ({ ...editableDefaults }))
  const [expandedFolders, setExpandedFolders] = useState({})

  const fileContentMap = useMemo(() => ({
    ...shaderFiles,
    ...engineFiles,
    ...sceneFilesAll,
    ...editableDefaults,
  }), [editableDefaults])

  const loadFileContent = useCallback(async (path) => {
    if (!path) return ''
    if (fileContents[path] !== undefined) return fileContents[path]
    if (path.startsWith('local/')) return ''
    const fileLoader = fileContentMap[path]
    if (!fileLoader) return ''
    if (typeof fileLoader === 'string') {
      setFileContents((prev) => ({ ...prev, [path]: fileLoader }))
      return fileLoader
    }
    if (typeof fileLoader === 'function') {
      try {
        const content = await fileLoader()
        setFileContents((prev) => ({ ...prev, [path]: content }))
        return content
      } catch (err) {
        console.error('Failed to load file content:', path, err)
      }
    }
    return ''
  }, [fileContentMap, fileContents])

  useEffect(() => {
    if (activeTabPath && fileContents[activeTabPath] === undefined) {
      loadFileContent(activeTabPath)
    }
  }, [activeTabPath, fileContents, loadFileContent])

  // Ray Tracing coordinator initialization
  useEffect(() => {
    if (!cpuCanvasRef.current) return
    const coordinator = createRayTracingCoordinator({
      cpuCanvas: cpuCanvasRef.current,
      cpuFactory: initBundledCpuRayEngine,
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

  // Trigger engine/coordinator resize when switching modes or resizing panels
  useEffect(() => {
    const timer = setTimeout(() => {
      rayCoordinatorRef.current?.resize()
      if (engineRef.current && typeof engineRef.current.resize === 'function') {
        engineRef.current.resize()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [uiMode, showExplorer, showEditorPanel])

  // Engine boot
  useEffect(() => {
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
        : { vertex: fileContents[defaultVertPath] ?? defaultVert, fragment: fileContents[defaultFragPath] ?? defaultFrag }

      const engine = await initEngine({
        canvas,
        backend,
        shaderSources,
        scriptSource: fileContents[sceneScriptPath] ?? defaultScript,
        onError: (err) => {
          if (!cancelled) setError(err?.message || String(err))
        },
      })

      if (cancelled) {
        if (engine && typeof engine.destroy === 'function') {
          try { engine.destroy() } catch (e) { /* ignore */ }
        }
        return
      }
      engineRef.current = engine
      rayCoordinatorRef.current?.setRasterEngine(engine)

      if (typeof window !== 'undefined') {
        window.__DRISHYAM_ENGINE = engine
        if (isVisualTest) {
          import('@engine/raytracing/visual-test-api.js').then(({ createRayVisualTestApi }) => {
            if (!cancelled) {
              window.__DRISHYAM_RAY_TEST = createRayVisualTestApi({ engine, coordinator: rayCoordinatorRef.current })
            }
          }).catch((err) => console.error('Failed to initialize visual test API:', err))
        }
      }

      setupSettings(() => {})
      geometryFactoryRef.current = backend === 'webgpu'
        ? createWebGPUGeometryFactory(engine.device, logoJpg)
        : {
            createCube: () => createDefaultCube(engine.gl),
            createTexturedCube: () => createDefaultTexturedCube(engine.gl, logoJpg),
            createSphere: () => createSphere(engine.gl),
            createTexturedSphere: () => createTexturedSphere(engine.gl, logoJpg),
          }

      setEngineReady((n) => n + 1)
    }

    boot()

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        if (window.__DRISHYAM_ENGINE === engineRef.current) window.__DRISHYAM_ENGINE = null
        window.__DRISHYAM_RAY_TEST = null
      }
      if (engineRef.current) {
        if (typeof engineRef.current.destroy === 'function') {
          try { engineRef.current.destroy() } catch (e) { /* ignore */ }
        }
        engineRef.current = null
      }
      rayCoordinatorRef.current?.setRasterEngine(null)
      geometryFactoryRef.current = null
    }
  }, [backend])

  useEffect(() => {
    setHasModelLoaded(false)
    setCurrentShape(pendingActionRef.current ? null : 'cube')
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

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    const pendingAction = pendingActionRef.current
    if (!pendingAction) return
    pendingActionRef.current = null

    if (pendingAction === 'sample') {
      loadBuiltInSample()
    } else if (pendingAction === 'hybrid-shadows') {
      handleLoadSampleWithHybridShadows()
    } else if (pendingAction === 'gpu-cornell') {
      handleLoadGpuCornellBox()
    }
  }, [engineReady])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatDebugMode?.(splatDebug)
  }, [engineReady, splatDebug, splatLoaded])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatShDegree?.(shDegree)
  }, [engineReady, shDegree, splatLoaded])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatRenderMode?.(splatRenderMode)
  }, [engineReady, splatRenderMode, splatLoaded])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatSort?.(splatSort)
  }, [engineReady, splatSort, splatLoaded])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatReduction?.(splatReduction)
  }, [engineReady, splatReduction, splatLoaded])

  useEffect(() => {
    if (!engineReady || !engineRef.current) return
    engineRef.current.setSplatFlipY?.(flipSplatY)
  }, [engineReady, flipSplatY, splatLoaded])

  useEffect(() => {
    const progressive = renderMode === 'raytrace-cpu' || renderMode === 'raytrace-gpu'
    if ((!showStats && !progressive) || !engineReady) return
    const engine = renderMode === 'raytrace-cpu' ? rayCoordinatorRef.current : engineRef.current
    const timer = setInterval(() => {
      if (engine && typeof engine.getStats === 'function') {
        const currentStats = engine.getStats()
        if (currentStats) setStats(currentStats)
      }
    }, 200)
    return () => clearInterval(timer)
  }, [showStats, engineReady, renderMode])

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
      return drawable
    } catch (err) {
      setCurrentShape('cube')
      setError(`Sample GLTF Error: ${err?.message || String(err)}`)
    }
  }

  async function handleLoadSample() {
    if (backend !== 'webgpu') {
      pendingActionRef.current = 'sample'
      setError(null)
      setBackend('webgpu')
      return
    }
    return await loadBuiltInSample()
  }

  async function handleLoadSampleWithHybridShadows() {
    try {
      if (backend !== 'webgpu') {
        pendingActionRef.current = 'hybrid-shadows'
        setBackend('webgpu')
        return
      }
      const drawable = await loadBuiltInSample()
      if (drawable && rayCoordinatorRef.current) {
        await rayCoordinatorRef.current.setRenderMode('hybrid-shadows')
        rayCoordinatorRef.current.setLight(hybridLight)
        setRenderMode('hybrid-shadows')
        setRayPaused(false)
        setError(null)
      }
    } catch (err) {
      setError(`Hybrid Shadows Sample Error: ${err?.message || String(err)}`)
    }
  }

  async function handleLoadCornellBox() {
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      await coordinator.loadCornellBox()
      await coordinator.setRenderMode('raytrace-cpu')
      coordinator.setRayTracingSettings(raySettings)
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

  async function handleLoadGpuCornellBox() {
    if (backend !== 'webgpu') {
      pendingActionRef.current = 'gpu-cornell'
      setBackend('webgpu')
      return
    }
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      await coordinator.loadCornellBox('raytrace-gpu')
      await coordinator.setRenderMode('raytrace-gpu')
      coordinator.setRayTracingSettings(raySettings)
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

  async function handleLoadAssetFolder() {
    const engine = engineRef.current
    if (!engine) return
    if (pickerActiveRef.current || window.__DRISHYAM_PICKER_ACTIVE) return
    pickerActiveRef.current = true
    window.__DRISHYAM_PICKER_ACTIVE = true
    try {
      await rayCoordinatorRef.current?.setRenderMode('raster')
      let kind, drawable
      if (window.showDirectoryPicker) {
        const dirHandle = await window.showDirectoryPicker()
        ;({ kind, drawable } = await loadAssetFromDirectory({ engine, dirHandle, flipY: flipSplatY }))
      } else {
        const isWebGPU = backend === 'webgpu'
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = isWebGPU ? '.ply,.gltf,.bin,image/*' : '.gltf,.bin,image/*'
        input.multiple = true
        const files = await new Promise((resolve) => {
          let resolved = false
          const handleFocus = () => {
            setTimeout(() => {
              if (!resolved) {
                resolved = true
                window.removeEventListener('focus', handleFocus)
                resolve([])
              }
            }, 500)
          }
          input.onchange = () => {
            resolved = true
            window.removeEventListener('focus', handleFocus)
            resolve(Array.from(input.files || []))
          }
          window.addEventListener('focus', handleFocus, { once: true })
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

  async function handleResetScene() {
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

  async function selectRayRenderMode(nextMode) {
    const coordinator = rayCoordinatorRef.current
    if (!coordinator) return
    try {
      if (rayPaused) coordinator.resume()

      if (nextMode === 'raster') {
        await coordinator.setRenderMode('raster')
      } else if (nextMode === 'raytrace-cpu') {
        if (!hasRayScene) {
          await handleLoadCornellBox()
        } else {
          await coordinator.setRenderMode('raytrace-cpu')
          coordinator.setRayTracingSettings(raySettings)
        }
      } else if (nextMode === 'raytrace-gpu') {
        if (backend !== 'webgpu') {
          pendingActionRef.current = 'gpu-cornell'
          setBackend('webgpu')
          return
        }
        if (!hasRayScene) {
          await handleLoadGpuCornellBox()
        } else {
          await coordinator.setRenderMode('raytrace-gpu')
          coordinator.setRayTracingSettings(raySettings)
        }
      } else if (nextMode === 'hybrid-shadows') {
        if (backend !== 'webgpu') {
          pendingActionRef.current = 'hybrid-shadows'
          setBackend('webgpu')
          return
        }
        if (!hasHybridScene) {
          await handleLoadSampleWithHybridShadows()
        } else {
          await coordinator.setRenderMode('hybrid-shadows')
          coordinator.setLight(hybridLight)
        }
      }
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

  function updateRayTracingSettings(partial) {
    const next = mergeRayTracingSettings(raySettings, partial)
    try {
      rayCoordinatorRef.current?.setRayTracingSettings(next)
      setRaySettings(next)
      setError(null)
    } catch (err) {
      setError(`Ray Tracing Settings Error: ${err?.message || String(err)}`)
    }
  }

  function updateHybridLight(partial) {
    const next = mergeHybridLight(hybridLight, partial)
    try {
      rayCoordinatorRef.current?.setLight(next)
      setHybridLight(next)
      setError(null)
    } catch (err) {
      setError(`Hybrid Light Error: ${err?.message || String(err)}`)
    }
  }

  async function handleOpenLocalFile() {
    try {
      const result = await openTextFile()
      if (!result) return
      const { name, text, handle } = result
      const path = `local/${name}`

      // Update file content state immediately
      setFileContents((prev) => ({ ...prev, [path]: text }))

      let role = 'script'
      if (name.endsWith('.wgsl')) role = 'wgsl'
      else if (name.endsWith('.vert')) role = 'vert'
      else if (name.endsWith('.frag')) role = 'frag'
      else if (name.endsWith('.js')) role = 'script'

      setOpenFiles((prev) => {
        const filtered = prev.filter((f) => f.path !== path)
        return [...filtered, { path, name, role, isDirty: false, handle }]
      })

      // Switch to Studio Edit Mode so the editor is visible and active
      setUiMode('edit')
      setShowEditorPanel(true)
      setActiveTabPath(path)
      setError(null)
    } catch (err) {
      setError(`Open File Error: ${err?.message || String(err)}`)
    }
  }

  async function handleSaveActiveFile() {
    const activeFile = openFiles.find((f) => f.path === activeTabPath)
    if (!activeFile) return
    const content = fileContents[activeTabPath] ?? ''
    try {
      const handle = await saveTextFile(activeFile.handle, content, activeFile.name)
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === activeTabPath ? { ...f, handle: handle || f.handle, isDirty: false } : f))
      )
    } catch (err) {
      setError(`Save File Error: ${err?.message || String(err)}`)
    }
  }

  function handleFileContentChange(path, val) {
    setFileContents((prev) => ({ ...prev, [path]: val }))
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, isDirty: true } : f))
    )
    if (autoRefresh) {
      handleApply(path, val)
    }
  }

  function handleApply(targetPath = activeTabPath, contentOverride = null) {
    const e = engineRef.current
    if (!e) return setError('Engine not initialized')

    const getContent = (p) => (p === targetPath && contentOverride !== null ? contentOverride : (fileContents[p] ?? ''))

    if (targetPath.endsWith('.wgsl')) {
      const ok = e.setShaders?.(getContent(targetPath))
      if (!ok && e.setShaders) setError('Shader compilation failed')
      else setError(null)
    } else if (targetPath.endsWith('.vert') || targetPath.endsWith('.frag')) {
      const vertCode = targetPath.endsWith('.vert') ? getContent(targetPath) : getContent(defaultVertPath)
      const fragCode = targetPath.endsWith('.frag') ? getContent(targetPath) : getContent(defaultFragPath)
      const ok = e.setShaders?.(vertCode, fragCode)
      if (!ok && e.setShaders) setError('Shader compilation failed')
      else setError(null)
    } else if (targetPath.endsWith('.js')) {
      if (targetPath === sceneScriptPath) {
        const ok = e.setScriptSource?.(getContent(targetPath))
        if (!ok && e.setScriptSource) setError('Script compilation failed')
        else setError(null)
      } else {
        setError('External JavaScript files are view/edit-only and not executed for security.')
      }
    }
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen((prev) => !prev)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpenLocalFile()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveActiveFile()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleApply()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabPath, openFiles, fileContents])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  const commandPaletteActions = [
    { id: 'mode-view', label: 'Switch to Minimal View Mode', category: 'Layout', run: () => setUiMode('view') },
    { id: 'mode-edit', label: 'Switch to Edit Studio Mode', category: 'Layout', run: () => setUiMode('edit') },
    { id: 'cornell-cpu', label: 'Load Cornell Box (CPU Path Tracing)', category: 'Ray Tracing', run: handleLoadCornellBox },
    { id: 'cornell-gpu', label: 'Load Cornell Box (GPU Path Tracing)', category: 'Ray Tracing', run: handleLoadGpuCornellBox },
    { id: 'load-sample-raster', label: 'Load Sample glTF Model (Raster)', category: 'Assets', run: handleLoadSample },
    { id: 'load-sample-shadows', label: 'Load Sample glTF Model (Ray-Traced Shadows)', category: 'Ray Tracing', run: handleLoadSampleWithHybridShadows },
    { id: 'load-folder', label: 'Load Asset Folder (GLTF / PLY)', category: 'Assets', run: handleLoadAssetFolder },
    { id: 'open-file', label: 'Open Local Shader/Script File...', category: 'File', shortcut: '⌘O', run: handleOpenLocalFile },
    { id: 'save-file', label: 'Save Active File to Disk', category: 'File', shortcut: '⌘S', run: handleSaveActiveFile },
    { id: 'backend-gpu', label: 'Switch Renderer to WebGPU', category: 'Engine', run: () => setBackend('webgpu') },
    { id: 'backend-gl', label: 'Switch Renderer to WebGL', category: 'Engine', run: () => setBackend('webgl') },
    { id: 'splat-sort-bitonic', label: 'Splat Sort: GPU Bitonic', category: 'Splatting', run: () => setSplatSort('bitonic') },
    { id: 'splat-sort-radix', label: 'Splat Sort: GPU Radix', category: 'Splatting', run: () => setSplatSort('radix') },
    { id: 'splat-reduct-none', label: 'Splat Culling: None', category: 'Splatting', run: () => setSplatReduction('none') },
    { id: 'splat-reduct-culled', label: 'Splat Culling: Frustum / Grid Culled', category: 'Splatting', run: () => setSplatReduction('culled') },
    { id: 'splat-render-instanced', label: 'Splat Renderer: Instanced Quads', category: 'Splatting', run: () => setSplatRenderMode('instanced') },
    { id: 'splat-render-tile', label: 'Splat Renderer: Tile-Based Compute', category: 'Splatting', run: () => setSplatRenderMode('tile') },
    { id: 'splat-sh-0', label: 'Splat Spherical Harmonics: Degree 0 (Diffuse)', category: 'Splatting', run: () => setShDegree(0) },
    { id: 'splat-sh-3', label: 'Splat Spherical Harmonics: Degree 3 (Full View-Dependent)', category: 'Splatting', run: () => setShDegree(3) },
    { id: 'splat-flip-y', label: 'Splat Orientation: Toggle Flip Y-Axis', category: 'Splatting', run: () => setFlipSplatY((f) => !f) },
    { id: 'splat-debug-off', label: 'Splat Debug: Off (Full Gaussian)', category: 'Splatting', run: () => setSplatDebug('off') },
    { id: 'splat-debug-points', label: 'Splat Debug: Points (Centers)', category: 'Splatting', run: () => setSplatDebug('points') },
    { id: 'splat-debug-sorted', label: 'Splat Debug: Points (Sorted Depth)', category: 'Splatting', run: () => setSplatDebug('points-sorted') },
    { id: 'toggle-stats', label: 'Toggle Real-Time Performance HUD', category: 'View', run: () => setShowStats((s) => !s) },
    { id: 'reset-scene', label: 'Reset 3D Scene', category: 'Scene', run: handleResetScene },
    { id: 'help-shortcuts', label: 'View Keyboard Shortcuts', category: 'Help', run: () => setIsShortcutsOpen(true) },
  ]

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

  const activeFileContent = fileContents[activeTabPath] ?? ''
  let activeFileMode = 'javascript'
  if (activeTabPath.endsWith('.vert')) activeFileMode = 'x-shader/x-vertex'
  else if (activeTabPath.endsWith('.frag')) activeFileMode = 'x-shader/x-fragment'
  else if (activeTabPath.endsWith('.glsl')) activeFileMode = 'x-shader/x-fragment'

  const activeFileReadOnly = activeTabPath.includes('/engine/')

  const rayTracingControlsContent = (
    <RayTracingControls
      backend={backend}
      renderMode={renderMode}
      hasRayScene={hasRayScene}
      hasHybridScene={hasHybridScene}
      capabilities={rayCoordinatorRef.current?.getCapabilities?.() || {}}
      paused={rayPaused}
      spp={stats?.spp || 0}
      raySettings={raySettings}
      hybridLight={hybridLight}
      onSelectMode={selectRayRenderMode}
      onTogglePause={toggleRayPause}
      onResetAccumulation={resetRayAccumulation}
      onChangeRaySettings={updateRayTracingSettings}
      onChangeHybridLight={updateHybridLight}
    />
  )

  return (
    <div className={`app-root ${uiMode === 'view' ? 'mode-view' : 'mode-edit'}`}>
      {/* View Mode Floating Bar & Legend */}
      {uiMode === 'view' && (
        <>
          <FloatingControlBar
            uiMode={uiMode}
            setUiMode={setUiMode}
            backend={backend}
            setBackend={setBackend}
            splatLoaded={splatLoaded}
            splatDebug={splatDebug}
            setSplatDebug={setSplatDebug}
            showStats={showStats}
            setShowStats={setShowStats}
            renderMode={renderMode}
            setRenderMode={selectRayRenderMode}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onResetScene={handleResetScene}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            logoJpg={logoJpg}
            stats={stats}
            paused={rayPaused}
            onTogglePause={toggleRayPause}
          />
          <MinimalLegend backend={backend} uiMode={uiMode} renderMode={renderMode} />
        </>
      )}

      {/* Edit Studio Mode Header */}
      {uiMode === 'edit' && (
        <TopMenuBar
          backend={backend}
          setBackend={setBackend}
          uiMode={uiMode}
          setUiMode={setUiMode}
          textured={textured}
          setTextured={setTextured}
          currentShape={currentShape}
          onSelectShape={(shape) => {
            setHasModelLoaded(false)
            setSplatLoaded(false)
            setCurrentShape(shape)
          }}
          splatLoaded={splatLoaded}
          splatDebug={splatDebug}
          setSplatDebug={setSplatDebug}
          splatSort={splatSort}
          setSplatSort={setSplatSort}
          splatReduction={splatReduction}
          setSplatReduction={setSplatReduction}
          splatRenderMode={splatRenderMode}
          setSplatRenderMode={setSplatRenderMode}
          shDegree={shDegree}
          setShDegree={setShDegree}
          flipSplatY={flipSplatY}
          setFlipSplatY={setFlipSplatY}
          showStats={showStats}
          setShowStats={setShowStats}
          showExplorer={showExplorer}
          setShowExplorer={setShowExplorer}
          showEditorPanel={showEditorPanel}
          setShowEditorPanel={setShowEditorPanel}
          onLoadSampleModel={handleLoadSample}
          onLoadSampleHybridShadows={handleLoadSampleWithHybridShadows}
          onLoadAssetFolder={handleLoadAssetFolder}
          onLoadCornellBox={handleLoadCornellBox}
          onLoadGpuCornellBox={handleLoadGpuCornellBox}
          onOpenLocalFile={handleOpenLocalFile}
          onSaveActiveFile={handleSaveActiveFile}
          onResetScene={handleResetScene}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenShortcutsModal={() => setIsShortcutsOpen(true)}
          logoJpg={logoJpg}
          renderMode={renderMode}
          RayTracingControlsContent={rayTracingControlsContent}
        />
      )}

      {/* Persistent Content Canvas Viewport (Never unmounted when toggling modes!) */}
      <div className="content">
        {uiMode === 'edit' && showExplorer && (
          <FileExplorer
            shaderTree={shaderTree}
            sceneTree={sceneTree}
            engineTree={engineTree}
            activePath={activeTabPath}
            openFiles={openFiles}
            onSelectFile={async (path) => {
              await loadFileContent(path)
              if (!openFiles.some((f) => f.path === path)) {
                const name = path.split('/').pop()
                const role = path.includes('/engine/') ? 'readonly' : 'editable'
                setOpenFiles((prev) => [...prev, { path, name, role, isDirty: false }])
              }
              setActiveTabPath(path)
            }}
            expandedFolders={expandedFolders}
            onToggleFolder={(path) =>
              setExpandedFolders((prev) => ({ ...prev, [path]: prev[path] === false }))
            }
            onOpenLocalFile={handleOpenLocalFile}
            onLoadAssetFolder={handleLoadAssetFolder}
          />
        )}

        <div className="center-panel">
          <ViewportCanvases
            rasterCanvasRef={canvasRef}
            cpuCanvasRef={cpuCanvasRef}
            rasterKey={backend}
            renderMode={renderMode}
          >
            <StatsOverlay stats={stats} showStats={showStats} />
          </ViewportCanvases>
        </div>

        {uiMode === 'edit' && showEditorPanel && (
          <CodeEditorPanel
            openFiles={openFiles}
            activeTabPath={activeTabPath}
            onSelectTab={(path) => setActiveTabPath(path)}
            onCloseTab={(path) => {
              const next = openFiles.filter((f) => f.path !== path)
              setOpenFiles(next)
              if (activeTabPath === path && next.length) setActiveTabPath(next[0].path)
            }}
            onFileContentChange={handleFileContentChange}
            activeFileContent={activeFileContent}
            activeFileMode={activeFileMode}
            activeFileReadOnly={activeFileReadOnly}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
            onApply={handleApply}
            onResetActive={() =>
              setFileContents((prev) => ({ ...prev, [activeTabPath]: editableDefaults[activeTabPath] ?? '' }))
            }
            onSaveActiveFile={handleSaveActiveFile}
            error={error}
          />
        )}
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        actions={commandPaletteActions}
      />
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  )
}
