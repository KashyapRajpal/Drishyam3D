const fileStructure = [
    { 
        name: 'Project Files', type: 'folder', children: [
            { id: 'script', name: 'scene-script.js', type: 'javascript', readOnly: false },
        ]
    },
    {
        name: 'Shaders', type: 'folder', children: [
            { id: 'vertex', name: 'default.vert', type: 'x-shader/x-vertex', readOnly: false, path: '/assets/shaders/default.vert' },
            { id: 'fragment', name: 'default.frag', type: 'x-shader/x-fragment', readOnly: false, path: '/assets/shaders/default.frag' },
        ]
    },
    {
        name: 'Engine', type: 'folder', children: [
            {id: 'main', name: 'main.js', type: 'javascript', readOnly: false, path: '/scripts/main.js' },
            { id: 'scene', name: 'scene.js', type: 'javascript', readOnly: false, path: '/scripts/engine/scene.js' },
            { id: 'editor', name: 'editor.js', type: 'javascript', readOnly: false, path: '/scripts/engine/editor.js' },
            { id: 'explorer', name: 'explorer.js', type: 'javascript', readOnly: false, path: '/scripts/engine/explorer.js' },
            { id: 'geometry', name: 'geometry.js', type: 'javascript', readOnly: false, path: '/scripts/engine/geometry.js' },
            { id: 'gltf-parser', name: 'gltf-parser.js', type: 'javascript', readOnly: false, path: '/scripts/engine/gltf-parser.js' },
            { id: 'matrix', name: 'matrix.js', type: 'javascript', readOnly: false, path: '/scripts/engine/matrix.js' },
            { id: 'webgl-helpers', name: 'webgl-helpers.js', type: 'javascript', readOnly: false, path: '/scripts/engine/webgl-helpers.js' },
            { id: 'settings', name: 'settings.js', type: 'javascript', readOnly: false, path: '/scripts/engine/settings.js' },
            { id: 'menu-handlers', name: 'menu-handlers.js', type: 'javascript', readOnly: false, path: '/scripts/engine/menu-handlers.js' }
        ]
    }
];


/**
 * Sets up the file explorer panel.
 * @param {function(fileId: string, fileName: string, fileType: string, readOnly: boolean, path: string): void} onFileOpen - Callback to run when a file is double-clicked.
 */
export function setupExplorer(onFileOpen) {
    const explorerList = document.querySelector('#explorer-list');

    if (!explorerList) {
        console.error("Explorer list element not found!");
        return;
    }

    // Clear any existing items
    explorerList.innerHTML = '';

    function buildExplorer(items, container, depth = 0) {
        items.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.style.paddingLeft = `${depth * 20}px`;

            if (item.type === 'folder') {
                itemElement.className = 'folder-item';
                itemElement.textContent = `▶ ${item.name}`;
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-content';
                childrenContainer.style.display = 'none'; // Initially collapsed

                itemElement.addEventListener('click', () => {
                    const isCollapsed = childrenContainer.style.display === 'none';
                    childrenContainer.style.display = isCollapsed ? 'block' : 'none';
                    itemElement.textContent = `${isCollapsed ? '▼' : '▶'} ${item.name}`;
                });

                container.appendChild(itemElement);
                container.appendChild(childrenContainer);
                buildExplorer(item.children, childrenContainer, depth + 1);
            } else {
                itemElement.className = 'file-item';
                itemElement.textContent = item.name;
                itemElement.dataset.fileId = item.id;
                itemElement.addEventListener('dblclick', () => {
                    onFileOpen(item.id, item.name, item.type, item.readOnly, item.path);
                });
                container.appendChild(itemElement);
            }
        });
    }

    buildExplorer(fileStructure, explorerList);

    return {
        getProjectFiles: () => {
            const projectFiles = fileStructure.find(item => item.name === 'Project Files').children;
            const shaderFiles = fileStructure.find(item => item.name === 'Shaders').children;
            return [...projectFiles, ...shaderFiles];
        }
    };
}