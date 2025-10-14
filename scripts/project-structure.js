/**
 * Defines the file structure for the explorer panel.
 */

export const projectFiles = [
    { id: 'vertex', name: 'vertex-shader.glsl', type: 'x-shader/x-vertex', readOnly: false },
    { id: 'fragment', name: 'fragment-shader.glsl', type: 'x-shader/x-fragment', readOnly: false },
    { id: 'script', name: 'scene-script.js', type: 'javascript', readOnly: false },
];

export const engineFiles = [
    { id: 'main', name: 'main.js', type: 'javascript', readOnly: true, path: '../scripts/main.js' },
    { id: 'scene', name: 'scene.js', type: 'javascript', readOnly: true, path: '../scripts/scene.js' },
    { id: 'editor', name: 'editor.js', type: 'javascript', readOnly: true, path: '../scripts/editor.js' },
    { id: 'explorer', name: 'explorer.js', type: 'javascript', readOnly: true, path: '../scripts/explorer.js' },
];