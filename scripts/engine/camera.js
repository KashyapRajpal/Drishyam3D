/**
 * @file Provides a camera for orbiting and panning in the 3D scene.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix, createLookAtMatrix } from './matrix.js';

export class Camera {
    constructor(canvas, initialPosition = [0, 0, 5]) {
        this.canvas = canvas;
        this.position = initialPosition;
        this.target = [0, 0, 0];
        this.up = [0, 1, 0];
        this.zoom = 5;
        this.minZoom = 1;
        this.maxZoom = 20;
        this.rotation = { x: 0, y: 0 };
        this.isDragging = false;
        this.lastMousePosition = { x: 0, y: 0 };

        this.viewMatrix = createIdentityMatrix();
        // World-space eye position, refreshed by updateViewMatrix(). Needed by
        // view-dependent shading (e.g. spherical harmonics) as well as the view matrix.
        this.eye = [...initialPosition];
        this.destroyed = false;
        this.changeHandler = null;
        this.boundHandlers = {
            mousedown: this.onMouseDown.bind(this),
            mouseup: this.onMouseUp.bind(this),
            mousemove: this.onMouseMove.bind(this),
            wheel: this.onWheel.bind(this),
        };
        this.initEventListeners();
    }

    initEventListeners() {
        this.canvas.addEventListener('mousedown', this.boundHandlers.mousedown);
        this.canvas.addEventListener('mouseup', this.boundHandlers.mouseup);
        this.canvas.addEventListener('mousemove', this.boundHandlers.mousemove);
        this.canvas.addEventListener('wheel', this.boundHandlers.wheel);
    }

    onMouseDown(event) {
        this.isDragging = true;
        this.lastMousePosition = { x: event.clientX, y: event.clientY };
    }

    onMouseUp(event) {
        this.isDragging = false;
    }

    onMouseMove(event) {
        if (!this.isDragging) return;

        const dx = event.clientX - this.lastMousePosition.x;
        const dy = event.clientY - this.lastMousePosition.y;

        this.rotation.y += dx * 0.01;
        this.rotation.x += dy * 0.01;

        // Clamp the vertical rotation to avoid flipping
        this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotation.x));

        this.lastMousePosition = { x: event.clientX, y: event.clientY };
        this.updateViewMatrix();
        this.changeHandler?.(this.getState());
    }

    onWheel(event) {
        event.preventDefault();
        // Multiplicative, so one notch moves the same *fraction* of the distance
        // at any scale. A fixed additive step is unusable on small captures: a
        // 0.18-radius splat cloud has a usable range under 2 units, which a
        // single ~100px wheel event crossed entirely — reading as "zoom is stuck".
        this.zoom *= Math.exp(event.deltaY * 0.001);
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
        this.updateViewMatrix();
        this.changeHandler?.(this.getState());
    }



    updateViewMatrix() {
        // Orbit the eye around `target` (not the origin), so off-origin models
        // — e.g. scanned meshes whose centers sit far from (0,0,0) — stay framed.
        const t = this.target || [0, 0, 0];
        const eye = [
            t[0] + this.zoom * Math.sin(this.rotation.y) * Math.cos(this.rotation.x),
            t[1] + this.zoom * Math.sin(this.rotation.x),
            t[2] + this.zoom * Math.cos(this.rotation.y) * Math.cos(this.rotation.x)
        ];

        this.eye = eye;
        this.viewMatrix = createLookAtMatrix(eye, t, this.up);
    }

    getViewMatrix() {
        return this.viewMatrix;
    }

    /** World-space camera position (the eye used to build the view matrix). */
    getPosition() {
        return this.eye;
    }

    /**
     * Deterministically set the orbit pose — for scripted/visual-regression views.
     * @param {number} rotationX pitch (radians, clamped like the mouse path)
     * @param {number} rotationY yaw (radians)
     * @param {number} zoom camera distance from the target
     */
    setPose(rotationX, rotationY, zoom) {
        this.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationX));
        this.rotation.y = rotationY;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        this.updateViewMatrix();
        this.changeHandler?.(this.getState());
    }

    setChangeHandler(handler) {
        this.changeHandler = typeof handler === 'function' ? handler : null;
    }

    /** Serializable orbit state used when switching rendering presentations. */
    getState() {
        return {
            target: [...this.target],
            up: [...this.up],
            rotationX: this.rotation.x,
            rotationY: this.rotation.y,
            zoom: this.zoom,
            minZoom: this.minZoom,
            maxZoom: this.maxZoom,
        };
    }

    /** Restore a state returned by getState(). */
    setState(state) {
        if (!state) return;
        if (Array.isArray(state.target) && state.target.length === 3) this.target = [...state.target];
        if (Array.isArray(state.up) && state.up.length === 3) this.up = [...state.up];
        if (Number.isFinite(state.minZoom)) this.minZoom = state.minZoom;
        if (Number.isFinite(state.maxZoom)) this.maxZoom = state.maxZoom;
        this.setPose(
            Number.isFinite(state.rotationX) ? state.rotationX : this.rotation.x,
            Number.isFinite(state.rotationY) ? state.rotationY : this.rotation.y,
            Number.isFinite(state.zoom) ? state.zoom : this.zoom,
        );
    }

    /** Remove exactly the listeners registered by this camera. Safe to call twice. */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.changeHandler = null;
        this.isDragging = false;
        this.canvas.removeEventListener('mousedown', this.boundHandlers.mousedown);
        this.canvas.removeEventListener('mouseup', this.boundHandlers.mouseup);
        this.canvas.removeEventListener('mousemove', this.boundHandlers.mousemove);
        this.canvas.removeEventListener('wheel', this.boundHandlers.wheel);
    }
}
