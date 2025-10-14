const projectFiles = [
    { id: 'vertex', name: 'vertex-shader.glsl', type: 'x-shader/x-vertex', readOnly: false },
    { id: 'fragment', name: 'fragment-shader.glsl', type: 'x-shader/x-fragment', readOnly: false },
    { id: 'script', name: 'scene-script.js', type: 'javascript', readOnly: false },
];

const engineFiles = [
    { id: 'main', name: 'main.js', type: 'javascript', readOnly: true, path: '../scripts/main.js' },
    { id: 'scene', name: 'scene.js', type: 'javascript', readOnly: true, path: '../scripts/scene.js' },
    { id: 'editor', name: 'editor.js', type: 'javascript', readOnly: true, path: '../scripts/editor.js' },
    { id: 'explorer', name: 'explorer.js', type: 'javascript', readOnly: true, path: '../scripts/explorer.js' },
];


/**
 * Sets up the file explorer panel.
 * @param {function(fileId, fileName, fileType, readOnly, path): void} onFileOpen - Callback to run when a file is double-clicked.
 */
export function setupExplorer(onFileOpen) {
    const explorerList = document.querySelector('#explorer-list');

    if (!explorerList) {
        console.error("Explorer list element not found!");
        return;
    }

    // Clear any existing items
    explorerList.innerHTML = '';

    function createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.textContent = file.name;
        fileItem.dataset.fileId = file.id;

        fileItem.addEventListener('dblclick', () => {
            onFileOpen(file.id, file.name, file.type, file.readOnly, file.path);
        });
        return fileItem;
    }

    // Populate project files
    projectFiles.forEach(file => explorerList.appendChild(createFileItem(file)));

    // Add a separator and heading for application files
    const separator = document.createElement('hr');
    separator.style.borderColor = '#444';
    separator.style.margin = '10px 0';
    explorerList.appendChild(separator);

    const appHeader = document.createElement('div');
    appHeader.textContent = 'Engine Scripts';
    appHeader.style.padding = '4px 15px';
    appHeader.style.fontSize = '0.8em';
    appHeader.style.color = '#888';
    appHeader.style.textTransform = 'uppercase';
    explorerList.appendChild(appHeader);

    engineFiles.forEach(file => explorerList.appendChild(createFileItem(file)));

    return {
        getProjectFiles: () => projectFiles
    };
}