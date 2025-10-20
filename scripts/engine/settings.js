/**
 * @file Manages application settings and their corresponding UI elements.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

/**
 * Manages application settings and UI.
 * @param {function(setting: string, value: any): void} onSettingsUpdated - Callback when a setting changes.
 */
export function setupSettings(onSettingsUpdated) {
    const settings = {
        useTexturedDefaultCube: localStorage.getItem('useTexturedDefaultCube') === 'true',
    };

    // --- UI Elements ---
    const texturedCubeCheckbox = document.querySelector('#textured-cube-checkbox');
    const texturedCubeToggle = document.querySelector('#textured-cube-toggle');

    // --- Initialize UI ---
    if (texturedCubeCheckbox) {
        texturedCubeCheckbox.checked = settings.useTexturedDefaultCube;
    }

    // --- Event Listeners ---
    if (texturedCubeToggle) {
        texturedCubeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            settings.useTexturedDefaultCube = !settings.useTexturedDefaultCube;
            texturedCubeCheckbox.checked = settings.useTexturedDefaultCube;
            localStorage.setItem('useTexturedDefaultCube', settings.useTexturedDefaultCube);
            
            onSettingsUpdated('useTexturedDefaultCube', settings.useTexturedDefaultCube);
        });
    }

    return {
        get: (key) => settings[key],
    };
}