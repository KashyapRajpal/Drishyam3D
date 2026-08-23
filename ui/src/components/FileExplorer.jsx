import React from 'react'

function TreeNode({ node, activePath, openFiles, onSelectFile, onToggleFolder, expandedFolders }) {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders[node.path] !== false
    return (
      <div className="explorer-folder">
        <div
          className="explorer-row group"
          onClick={() => onToggleFolder(node.path)}
        >
          <span className="caret">{isExpanded ? '▾' : '▸'}</span>
          <span className="folder-icon">📁</span>
          <span className="folder-name">{node.name}</span>
        </div>
        {isExpanded && node.children && (
          <div className="explorer-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                activePath={activePath}
                openFiles={openFiles}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
                expandedFolders={expandedFolders}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isActive = activePath === node.path
  const isOpen = openFiles.some((f) => f.path === node.path)

  let fileBadge = '📄'
  if (node.name.endsWith('.wgsl')) fileBadge = '⚡'
  else if (node.name.endsWith('.vert') || node.name.endsWith('.frag')) fileBadge = '🎨'
  else if (node.name.endsWith('.js')) fileBadge = '📜'
  else if (node.name.endsWith('.effect')) fileBadge = '🪄'

  return (
    <div
      className={`explorer-row file ${isActive ? 'active-file' : ''} ${isOpen ? 'opened' : ''}`}
      onClick={() => onSelectFile(node.path)}
    >
      <span className="file-icon">{fileBadge}</span>
      <span className="file-name">{node.name}</span>
    </div>
  )
}

export function FileExplorer({
  shaderTree,
  sceneTree,
  engineTree,
  activePath,
  openFiles,
  onSelectFile,
  expandedFolders,
  onToggleFolder,
  onOpenLocalFile,
  onLoadAssetFolder,
}) {
  return (
    <aside className="left-panel flex-panel">
      <div className="explorer-header">
        <span className="explorer-title">EXPLORER</span>
        <div className="explorer-actions">
          <button type="button" className="icon-btn" title="Open Local File" onClick={onOpenLocalFile}>
            📄
          </button>
          <button type="button" className="icon-btn" title="Load Asset Folder" onClick={onLoadAssetFolder}>
            📂
          </button>
        </div>
      </div>

      <div className="explorer-tree">
        {shaderTree && (
          <TreeNode
            node={shaderTree}
            activePath={activePath}
            openFiles={openFiles}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            expandedFolders={expandedFolders}
          />
        )}
        {sceneTree && (
          <TreeNode
            node={sceneTree}
            activePath={activePath}
            openFiles={openFiles}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            expandedFolders={expandedFolders}
          />
        )}
        {engineTree && (
          <TreeNode
            node={engineTree}
            activePath={activePath}
            openFiles={openFiles}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            expandedFolders={expandedFolders}
          />
        )}
      </div>
    </aside>
  )
}
