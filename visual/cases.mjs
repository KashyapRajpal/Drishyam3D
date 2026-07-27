/**
 * Visual-regression cases: camera pose × SH degree × reduction mode.
 *
 * rotX = pitch (radians), rotY = yaw (radians), zoom = camera distance.
 * sh = evaluated SH degree (0 flat … 3 full). reduction = 'none' | 'culled'.
 *
 * Edit freely — each case is one golden image. Names must be filesystem-safe.
 */
export const cases = [
    // --- baseline instanced (None reduction) across angles ---
    { name: 'front-sh3-none',    rotX: 0.0,  rotY: 0.0,          zoom: 5, sh: 3, reduction: 'none' },
    { name: 'side-sh3-none',     rotX: 0.0,  rotY: Math.PI / 2,  zoom: 5, sh: 3, reduction: 'none' },
    { name: 'threeq-sh3-none',   rotX: 0.4,  rotY: 0.8,          zoom: 5, sh: 3, reduction: 'none' },
    { name: 'top-sh3-none',      rotX: 1.1,  rotY: 0.0,          zoom: 5, sh: 3, reduction: 'none' },

    // --- SH-degree sweep (view-dependent colour) at a fixed angle ---
    { name: 'threeq-sh0-none',   rotX: 0.4,  rotY: 0.8,          zoom: 5, sh: 0, reduction: 'none' },
    { name: 'threeq-sh1-none',   rotX: 0.4,  rotY: 0.8,          zoom: 5, sh: 1, reduction: 'none' },
    { name: 'threeq-sh2-none',   rotX: 0.4,  rotY: 0.8,          zoom: 5, sh: 2, reduction: 'none' },

    // --- Culled reduction: should match None from angles that keep the scene on-screen ---
    { name: 'front-sh3-culled',  rotX: 0.0,  rotY: 0.0,          zoom: 5, sh: 3, reduction: 'culled' },
    { name: 'threeq-sh3-culled', rotX: 0.4,  rotY: 0.8,          zoom: 5, sh: 3, reduction: 'culled' },
];
