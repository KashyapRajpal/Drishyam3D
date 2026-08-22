import React from 'react'

/** Two physical canvases avoid requesting WebGL/WebGPU and 2D contexts on one element. */
export function ViewportCanvases({ rasterCanvasRef, cpuCanvasRef, rasterKey, renderMode, children }) {
  const cpuVisible = renderMode === 'raytrace-cpu'
  return (
    <div className="viewport-canvas-wrap">
      <canvas
        key={rasterKey}
        ref={rasterCanvasRef}
        className={`viewport-canvas ${cpuVisible ? 'viewport-canvas-hidden' : ''}`}
        id="glcanvas"
        aria-label="3D scene viewport"
        aria-hidden={cpuVisible}
      />
      <canvas
        ref={cpuCanvasRef}
        className={`viewport-canvas cpu-ray-canvas ${cpuVisible ? '' : 'viewport-canvas-hidden'}`}
        id="cpu-ray-canvas"
        aria-label="CPU ray traced viewport"
        aria-hidden={!cpuVisible}
      />
      {children}
    </div>
  )
}
