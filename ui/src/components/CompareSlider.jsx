import React, { useState, useRef, useEffect } from 'react'

export function CompareSlider({ enabled, split, onChangeSplit, leftLabel = 'Textured', rightLabel = 'Wireframe / Untextured' }) {
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isDragging || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      const nextSplit = x / rect.width
      onChangeSplit(nextSplit)
    }

    const handlePointerUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isDragging, onChangeSplit])

  if (!enabled) return null

  return (
    <div className="compare-slider-overlay" ref={containerRef}>
      <div className="compare-label compare-label-left">{leftLabel}</div>
      <div className="compare-label compare-label-right">{rightLabel}</div>
      <div
        className="compare-divider"
        style={{ left: `${split * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
      >
        <div className="compare-handle">
          <span>⯇</span>
          <span>⯈</span>
        </div>
      </div>
    </div>
  )
}
