// The 'state' object is passed from the main application.
// 'state' contains: modelViewMatrix, projectionMatrix
// 'deltaTime' is the time in seconds since the last frame.

function init(state) {
    // This function is called once when the script is loaded.
    state.modelRotation = 0.0;
}

function update(state, deltaTime) {
    // This function is called on every frame.
    rotateMatrix(state.modelViewMatrix, state.modelRotation, [0, 1, 0]);
    state.modelRotation += deltaTime * 0.5;
}
