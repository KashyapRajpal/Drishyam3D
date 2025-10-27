/**
 * @file Manages the CodeMirror editors, tabs, and UI interactions.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

/**
 * Initializes the CodeMirror editors and sets up UI event listeners.
 * @param {function} onRun - The callback function to execute when the "Run" button is clicked.
 * @param {function} onEditorChange - The callback function to execute when any editor content changes.
 */
export function setupEditors(onRun, onEditorChange) {
    const editorTabsContainer = document.querySelector('.editor-tabs');
    const openEditors = {}; // Stores { id: { editor, tabEl } }
    const readOnlyBanner = document.querySelector('#readonly-warning-banner');
    let activeEditorId = null;

    function switchToTab(fileId) {
        if (!openEditors[fileId] || activeEditorId === fileId) {
            return;
        }

        // Deactivate current tab
        if (activeEditorId && openEditors[activeEditorId]) {
            openEditors[activeEditorId].tabEl.classList.remove('active');
            openEditors[activeEditorId].editor.getWrapperElement().classList.remove('active');
        }

        // Activate new tab
        const newEditor = openEditors[fileId];
        newEditor.tabEl.classList.add('active');
        newEditor.editor.getWrapperElement().classList.add('active');
        newEditor.editor.refresh();

        // Show or hide the read-only banner
        readOnlyBanner.style.display = newEditor.readOnly ? 'block' : 'none';

        activeEditorId = fileId;
    }

    function closeEditor(fileIdToClose, event) {
        event.stopPropagation(); // Prevent tab switching when clicking the close button

        if (!openEditors[fileIdToClose]) return;

        let nextActiveId = null;
        // If we are closing the active tab, we need to find a new one to activate
        if (activeEditorId === fileIdToClose) {
            const tabIds = Object.keys(openEditors);
            const currentIndex = tabIds.indexOf(fileIdToClose);

            if (tabIds.length > 1) {
                // Prefer activating the tab to the left, otherwise the one to the right
                if (currentIndex > 0) {
                    nextActiveId = tabIds[currentIndex - 1];
                } else {
                    nextActiveId = tabIds[currentIndex + 1]; // The one that will become the first tab
                }
            }
        }

        // Remove the editor and its tab
        const { editor, tabEl } = openEditors[fileIdToClose];
        editor.getWrapperElement().remove();
        tabEl.remove();
        delete openEditors[fileIdToClose];

        // Activate the next tab if necessary
        if (nextActiveId) {
            activeEditorId = null; // Force switchToTab to activate the new tab
            switchToTab(nextActiveId);
        } else if (Object.keys(openEditors).length === 0) {
            // No tabs left
            activeEditorId = null;
        }
    }

    async function openEditor(fileId, fileName, fileType, readOnly = false, path = null) {
        if (openEditors[fileId]) {
            switchToTab(fileId);
            return Promise.resolve(); // Already open, resolve immediately
        }

        const textArea = document.querySelector(`#${fileId}-editor`);
        if (!textArea) {
            console.error(`Textarea with id #${fileId}-editor not found.`);
            return Promise.resolve(); // Cannot open, resolve immediately
        }

        // --- IMPORTANT: Populate textArea.value BEFORE CodeMirror.fromTextArea ---
        if (path) {
            try {
                const resolvedPath = window.__DRISHYAM_ASSET(path);
                const response = await fetch(resolvedPath);
                if (!response.ok) throw new Error(`Failed to fetch ${resolvedPath}`);
                const text = await response.text();
                textArea.value = text;
            } catch (err) {
                console.error(`Failed to fetch content for ${fileName}:`, err);
                textArea.value = `// Error: Could not load ${fileName}`;
            }
        }
        // If no path, it means the content is already in the HTML textarea (e.g., scene-script.js)

        // Now, initialize CodeMirror from the textarea.
        // We use setTimeout(0) to ensure CodeMirror's internal DOM manipulation
        // happens after the current call stack, giving it time to read the textarea's value.
        return new Promise(resolve => {
            setTimeout(() => {
                const tabEl = document.createElement('div');
                tabEl.className = 'tab';
                tabEl.dataset.fileId = fileId;
                tabEl.addEventListener('click', () => switchToTab(fileId));
                if (readOnly) tabEl.classList.add('read-only');

                const tabTitle = document.createElement('span');
                tabTitle.textContent = fileName;
                tabEl.appendChild(tabTitle);

                const closeBtn = document.createElement('span');
                closeBtn.className = 'tab-close-btn';
                closeBtn.textContent = 'x';
                closeBtn.addEventListener('click', (event) => closeEditor(fileId, event));
                tabEl.appendChild(closeBtn);
                editorTabsContainer.appendChild(tabEl);

                const editor = CodeMirror.fromTextArea(textArea, {
                    lineNumbers: true, mode: fileType, theme: "dracula",
                    lineWrapping: true, autoCloseBrackets: true, readOnly: readOnly,
                });

                if (!readOnly) {
                    editor.on('change', () => {
                        if (!openEditors[fileId].isDirty) {
                            openEditors[fileId].isDirty = true;
                            tabEl.classList.add('dirty');
                        }
                        if (onEditorChange) onEditorChange();
                    });
                }

                openEditors[fileId] = { editor, tabEl, readOnly };
                switchToTab(fileId);
                resolve();
            }, 0); // Defer to next tick
        });
    }

    // --- Run Button Logic ---
    const reloadButton = document.querySelector("#reload-button");
    reloadButton.addEventListener("click", onRun);

    return {
        openEditor,
        /**
         * Gets the CodeMirror instance for a given file ID.
         * @param {string} fileId - The ID of the file (e.g., 'vertex', 'fragment').
         * @returns {CodeMirror.Editor|null}
         */
        getEditor: (fileId) => {
            return openEditors[fileId] ? openEditors[fileId].editor : null;
        },
        /**
         * Gets all currently open editor instances.
         * @returns {Object.<string, CodeMirror.Editor>}
         */
        getAllEditors: () => {
            const editors = {};
            for (const fileId in openEditors) {
                editors[fileId] = openEditors[fileId].editor;
            }
            return editors;
        },
        /**
         * Clears the dirty state from all editable tabs.
         */
        clearAllDirtyStates: () => {
            for (const fileId in openEditors) {
                if (openEditors[fileId].isDirty) {
                    openEditors[fileId].isDirty = false;
                    openEditors[fileId].tabEl.classList.remove('dirty');
                }
            }
        }
    };
}