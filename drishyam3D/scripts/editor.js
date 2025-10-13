/**
 * Initializes the CodeMirror editors and sets up UI event listeners.
 * @param {function} onRun - The callback function to execute when the "Run" button is clicked.
 * @returns {object} An object containing the shader and script editor instances.
 */
export function setupEditors(onRun) {
    const shaderEditorTextArea = document.querySelector("#editor");
    const scriptEditorTextArea = document.querySelector("#script-editor");

    const shaderEditor = CodeMirror.fromTextArea(shaderEditorTextArea, {
        lineNumbers: true,
        mode: "x-shader/x-fragment",
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
        shader: shaderEditor,
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
    shaderEditor.getWrapperElement().classList.add('active'); // Show shader editor by default

    // --- Run Button Logic ---
    const reloadButton = document.querySelector("#reload-button");
    reloadButton.addEventListener("click", onRun);

    return { shaderEditor, scriptEditor };
}