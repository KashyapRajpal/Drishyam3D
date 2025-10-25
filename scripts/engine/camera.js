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
        const eye = [
            this.zoom * Math.sin(this.rotation.y) * Math.cos(this.rotation.x),
            this.zoom * Math.sin(this.rotation.x),
            this.zoom * Math.cos(this.rotation.y) * Math.cos(this.rotation.x)
        ];

        this.viewMatrix = createLookAtMatrix(eye, this.target, this.up);
    }

    getViewMatrix() {
        return this.viewMatrix;
    }
}
