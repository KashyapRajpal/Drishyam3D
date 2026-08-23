/**
 * Worker facade adapter providing OffscreenCanvas worker thread separation for Drishyam3D.
 * Falls back seamlessly to main-thread engine if OffscreenCanvas is unavailable or disabled.
 */

import { initEngine } from './app-facade.js'

export async function initThreadedEngine({ canvas, backend = 'webgl', shaderSources, scriptSource, onError, useWorker = false }) {
  // If offscreen worker is not requested or OffscreenCanvas is not supported, fallback to main thread
  if (!useWorker || !canvas || typeof canvas.transferControlToOffscreen !== 'function') {
    return initEngine({ canvas, backend, shaderSources, scriptSource, onError })
  }

  try {
    const offscreen = canvas.transferControlToOffscreen()
    const worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' })

    let currentStats = null

    worker.onmessage = (e) => {
      const { type, payload, error } = e.data
      if (type === 'ERROR' && onError) {
        onError(error)
      } else if (type === 'STATS') {
        currentStats = payload
      }
    }

    worker.postMessage(
      {
        type: 'INIT',
        payload: {
          canvas: offscreen,
          backend,
          shaderSources,
          scriptSource,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      },
      [offscreen]
    )

    const handleResize = () => {
      worker.postMessage({
        type: 'RESIZE',
        payload: {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      })
    }

    window.addEventListener('resize', handleResize)

    return {
      backend,
      worker,
      updateShaders: (sources) => worker.postMessage({ type: 'UPDATE_SHADERS', payload: sources }),
      updateScript: (script) => worker.postMessage({ type: 'UPDATE_SCRIPT', payload: script }),
      setSplatDebugMode: (mode) => worker.postMessage({ type: 'SET_SPLAT_DEBUG', payload: mode }),
      setSplatShDegree: (deg) => worker.postMessage({ type: 'SET_SPLAT_SH_DEGREE', payload: deg }),
      setSplatRenderMode: (mode) => worker.postMessage({ type: 'SET_SPLAT_RENDER_MODE', payload: mode }),
      getStats: () => currentStats,
      destroy: () => {
        window.removeEventListener('resize', handleResize)
        worker.postMessage({ type: 'DESTROY' })
        worker.terminate()
      },
    }
  } catch (err) {
    console.warn('Worker initialization failed, falling back to main thread engine:', err)
    return initEngine({ canvas, backend, shaderSources, scriptSource, onError })
  }
}
