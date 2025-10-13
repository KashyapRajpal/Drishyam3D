/**
 * Initializes the CodeMirror editors and sets up UI event listeners.
 * @param {function} onRun - The callback function to execute when the "Run" button is clicked.
 * @returns {object} An object containing the shader and script editor instances.
 * @returns {object} An object containing the vertex, fragment, and script editor instances.
 */
export function setupEditors(onRun) {
    const vertexEditorTextArea = document.querySelector("#vertex-editor");
    const fragmentEditorTextArea = document.querySelector("#fragment-editor");
    const scriptEditorTextArea = document.querySelector("#script-editor");

    const vertexShaderEditor = CodeMirror.fromTextArea(vertexEditorTextArea, {
        lineNumbers: true,
        mode: "x-shader/x-vertex",
        theme: "dracula",
        lineWrapping: true,
    });

    const fragmentShaderEditor = CodeMirror.fromTextArea(fragmentEditorTextArea, {
        lineNumbers: true,
        mode: "x-shader/x-vertex",
        theme: "dracula",
        lineWrapping: true,
    });

    const scriptEditor = CodeMirror.fromTextArea(scriptEditorTextArea, {
        lineNumbers: true,
        mode: "javascript",
        theme: "dracula",
        lineWrapping: true,
    });

    // --- Tab Switching Logic ---
    const editors = {
        vertex: vertexShaderEditor,
        fragment: fragmentShaderEditor,
        script: scriptEditor,
    };
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelector('.tab.active').classList.remove('active');
            tab.classList.add('active');
            const activeEditor = tab.dataset.editor;
            Object.keys(editors).forEach(key => {
                editors[key].getWrapperElement().classList.toggle('active', key === activeEditor);
            });
            editors[activeEditor].refresh();
        });
    });
    fragmentShaderEditor.getWrapperElement().classList.add('active'); // Show fragment shader editor by default

    // --- Run Button Logic ---
    const reloadButton = document.querySelector("#reload-button");
    reloadButton.addEventListener("click", onRun);

    return { vertexShaderEditor, fragmentShaderEditor, scriptEditor };
}