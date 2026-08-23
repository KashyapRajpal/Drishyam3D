/**
 * Dedicated Web Worker for OffscreenCanvas render loops in Drishyam3D.
 */

import { initEngine } from './app-facade.js'

let engineInstance = null
let statsInterval = null

self.onmessage = async (e) => {
  const { type, payload } = e.data

  switch (type) {
    case 'INIT': {
      const { canvas, backend, shaderSources, scriptSource } = payload
      try {
        engineInstance = await initEngine({
          canvas,
          backend,
          shaderSources,
          scriptSource,
          onError: (err) => {
            self.postMessage({ type: 'ERROR', error: err?.message || String(err) })
          },
        })

        if (statsInterval) clearInterval(statsInterval)
        statsInterval = setInterval(() => {
          if (engineInstance && typeof engineInstance.getStats === 'function') {
            const stats = engineInstance.getStats()
            if (stats) {
              self.postMessage({ type: 'STATS', payload: stats })
            }
          }
        }, 200)
      } catch (err) {
        self.postMessage({ type: 'ERROR', error: err?.message || String(err) })
      }
      break
    }
    case 'UPDATE_SHADERS': {
      if (engineInstance && typeof engineInstance.updateShaders === 'function') {
        engineInstance.updateShaders(payload)
      }
      break
    }
    case 'UPDATE_SCRIPT': {
      if (engineInstance && typeof engineInstance.updateScript === 'function') {
        engineInstance.updateScript(payload)
      }
      break
    }
    case 'SET_SPLAT_DEBUG': {
      if (engineInstance && typeof engineInstance.setSplatDebugMode === 'function') {
        engineInstance.setSplatDebugMode(payload)
      }
      break
    }
    case 'SET_SPLAT_SH_DEGREE': {
      if (engineInstance && typeof engineInstance.setSplatShDegree === 'function') {
        engineInstance.setSplatShDegree(payload)
      }
      break
    }
    case 'SET_SPLAT_RENDER_MODE': {
      if (engineInstance && typeof engineInstance.setSplatRenderMode === 'function') {
        engineInstance.setSplatRenderMode(payload)
      }
      break
    }
    case 'DESTROY': {
      if (statsInterval) clearInterval(statsInterval)
      if (engineInstance && typeof engineInstance.destroy === 'function') {
        try { engineInstance.destroy() } catch (e) { /* ignore */ }
      }
      engineInstance = null
      break
    }
    default:
      break
  }
}
