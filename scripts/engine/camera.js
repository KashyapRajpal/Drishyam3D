/**
 * @file Provides a camera for orbiting and panning in the 3D scene.
 * @copyright 2025 Kashyap Rajpal
 * @license MIT
 */

import { createIdentityMatrix, createLookAtMatrix, multiplyMatrices } from './matrix.js';

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
        this.initEventListeners();
    }

    initEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
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
    }

    onWheel(event) {
        event.preventDefault();
        this.zoom -= event.deltaY * 0.01;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
        this.updateViewMatrix();
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
    }
}
