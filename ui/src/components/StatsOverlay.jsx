import React from 'react'

function formatCount(n) {
  if (!n) return '0'
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toString()
}

export function StatsOverlay({ stats, showStats }) {
  if (!showStats || !stats) return null

  const isCpuRayTracing = stats.renderMode === 'raytrace-cpu'
  const isGpuRayTracing = stats.renderMode === 'raytrace-gpu'
  const isHybridRayTracing = stats.renderMode === 'hybrid-shadows'

  return (
    <div className="stats-overlay-hud glass-hud">
      <div className="stats-header">
        <span className="stats-badge">PERFORMANCE</span>
        <span className="stats-backend">{stats.backend?.toUpperCase()}</span>
      </div>

      <div className="stats-content">
        {isCpuRayTracing ? (
          <>
            <div>CPU Path Tracing · {stats.spp || 0} spp</div>
            <div>{formatCount(stats.raysPerSecond || 0)} rays/s · {(stats.frameMs || 0).toFixed(1)}ms pass</div>
          </>
        ) : isGpuRayTracing ? (
          <>
            <div>GPU Path Tracing · {stats.spp || 0} spp</div>
            <div>{stats.fps} FPS ({stats.frameMs}ms)</div>
          </>
        ) : isHybridRayTracing ? (
          <>
            <div>Hybrid Ray-traced Shadows</div>
            <div>{stats.fps} FPS ({stats.frameMs}ms)</div>
          </>
        ) : (
          <div className="fps-value">{stats.fps} <span className="fps-unit">FPS</span> <span className="ms-unit">({stats.frameMs}ms)</span></div>
        )}

        <div className="stats-kind">{stats.drawableKind}</div>

        {stats.triangleCount > 0 && (
          <div className="stats-triangles">{formatCount(stats.triangleCount)} triangles</div>
        )}
        {stats.blasBuildMs > 0 && <div className="stats-accent">BLAS {stats.blasBuildMs.toFixed(2)}ms</div>}
        {stats.tlasBuildMs > 0 && <div className="stats-accent">TLAS {stats.tlasBuildMs.toFixed(2)}ms</div>}

        {stats.splatCount > 0 && (
          <div className="stats-splats">
            <div>{formatCount(stats.splatCount)} splats</div>
            {stats.reductionMode === 'culled' && (
              <div className="stats-vis">
                {formatCount(stats.visibleSplats)} visible ({Math.round((1 - stats.visibleSplats / stats.splatCount) * 100)}% culled)
              </div>
            )}
            <div className="stats-timing">Sort ({stats.sortMode}): {stats.passMs?.sort != null ? `${stats.passMs.sort.toFixed(2)}ms` : '—'}</div>
            <div className="stats-timing">Render: {stats.passMs?.render != null ? `${stats.passMs.render.toFixed(2)}ms` : '—'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
