import React from 'react'

export function ShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null

  const shortcuts = [
    { key: '⌘ + K / Ctrl + K', description: 'Open Command Palette & Action Launcher' },
    { key: '⌘ + Enter / Ctrl + Enter', description: 'Apply Shader / Scene Script changes' },
    { key: '⌘ + S / Ctrl + S', description: 'Save current active file to local disk' },
    { key: 'Esc', description: 'Close modals, dropdowns, and palettes' },
    { key: 'Mouse Left Drag', description: 'Orbit 3D camera in viewport' },
    { key: 'Mouse Right Drag / Shift + Drag', description: 'Pan camera position' },
    { key: 'Mouse Wheel', description: 'Zoom camera in/out' },
  ]

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h3>⌨️ Keyboard & Control Shortcuts</h3>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-list">
          {shortcuts.map((sc) => (
            <div className="shortcut-row" key={sc.key}>
              <kbd>{sc.key}</kbd>
              <span>{sc.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
