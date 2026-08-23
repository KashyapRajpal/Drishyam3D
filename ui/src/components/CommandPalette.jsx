import React, { useState, useEffect, useRef } from 'react'

export function CommandPalette({ isOpen, onClose, actions }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const filteredActions = actions.filter((action) =>
    action.label.toLowerCase().includes(query.toLowerCase()) ||
    (action.category && action.category.toLowerCase().includes(query.toLowerCase()))
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (filteredActions.length ? (prev + 1) % filteredActions.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (filteredActions.length ? (prev - 1 + filteredActions.length) % filteredActions.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].run()
        onClose()
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette-header">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command or search actions (e.g. Load Splat, Switch WebGPU, Apply)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmd-k-kbd">Esc</kbd>
        </div>
        <div className="command-palette-results">
          {filteredActions.length === 0 ? (
            <div className="command-palette-empty">No matching actions found.</div>
          ) : (
            filteredActions.map((action, idx) => (
              <div
                key={action.id || idx}
                className={`command-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  action.run()
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="item-info">
                  <span className="item-label">{action.label}</span>
                  {action.category && <span className="item-category">{action.category}</span>}
                </div>
                {action.shortcut && <kbd className="item-shortcut">{action.shortcut}</kbd>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
