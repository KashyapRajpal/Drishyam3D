import React, { useRef, useEffect } from 'react'
import CodeMirror from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/dracula.css'
import 'codemirror/mode/javascript/javascript'
import 'codemirror/mode/clike/clike'

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
  }, [value, mode, readOnly])

  return <div className="code-editor" ref={hostRef} />
}

export function CodeEditorPanel({
  openFiles,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onFileContentChange,
  activeFileContent,
  activeFileMode,
  activeFileReadOnly,
  autoRefresh,
  setAutoRefresh,
  onApply,
  onResetActive,
  onSaveActiveFile,
  error,
}) {
  return (
    <aside className="right-panel flex-panel">
      {/* Editor Tabs Header */}
      <div className="editor-tabs">
        {openFiles.map((file) => {
          const isActive = file.path === activeTabPath
          const isDirty = file.isDirty
          return (
            <div
              key={file.path}
              className={`tab ${isActive ? 'active' : ''} ${isDirty ? 'dirty' : ''}`}
              onClick={() => onSelectTab(file.path)}
            >
              <span className="tab-label">
                {file.name}
                {isDirty && ' *'}
              </span>
              {openFiles.length > 1 && (
                <button
                  type="button"
                  className="tab-close"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(file.path)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Editor Code Area */}
      <div className="editor-area">
        <CodeEditor
          value={activeFileContent}
          mode={activeFileMode}
          readOnly={activeFileReadOnly}
          onChange={(val) => onFileContentChange(activeTabPath, val)}
        />
      </div>

      {/* Error Console Banner */}
      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{error}</span>
        </div>
      )}

      {/* Footer Toolbar */}
      <div className="editor-footer">
        <button
          type="button"
          className="btn primary-btn"
          disabled={activeFileReadOnly}
          onClick={onApply}
          title="Apply Shader / Script (Cmd+Enter)"
        >
          <span>⚡ Apply</span>
          <kbd>⌘↵</kbd>
        </button>
        <button
          type="button"
          className="btn secondary-btn"
          disabled={activeFileReadOnly}
          onClick={onSaveActiveFile}
          title="Save file to local disk (Cmd+S)"
        >
          <span>💾 Save</span>
          <kbd>⌘S</kbd>
        </button>
        <button
          type="button"
          className="btn subtle-btn"
          disabled={activeFileReadOnly}
          onClick={onResetActive}
        >
          Reset
        </button>

        <label className="auto-refresh-label">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>Auto Apply</span>
        </label>
      </div>
    </aside>
  )
}
