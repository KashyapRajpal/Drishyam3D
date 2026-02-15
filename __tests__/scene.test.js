import { createScene } from '../scripts/engine/scene.js';

// Mock WebGL context
const mockGl = {
    createTexture: jest.fn(() => 'texture'),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    viewport: jest.fn(),
    clearColor: jest.fn(),
    clearDepth: jest.fn(),
    enable: jest.fn(),
    depthFunc: jest.fn(),
    clear: jest.fn(),
    createBuffer: jest.fn(() => 'buffer'),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    vertexAttribPointer: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    disableVertexAttribArray: jest.fn(),
    useProgram: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    uniform1i: jest.fn(),
    uniform4fv: jest.fn(),
    activeTexture: jest.fn(),
    drawElements: jest.fn(),
    canvas: {
        width: 800,
        height: 600,
        clientWidth: 800,
        clientHeight: 600,
    },
    TEXTURE_2D: 'TEXTURE_2D',
    RGBA: 'RGBA',
    UNSIGNED_BYTE: 'UNSIGNED_BYTE',
    DEPTH_TEST: 'DEPTH_TEST',
    LEQUAL: 'LEQUAL',
    COLOR_BUFFER_BIT: 'COLOR_BUFFER_BIT',
    DEPTH_BUFFER_BIT: 'DEPTH_BUFFER_BIT',
    FLOAT: 'FLOAT',
    ARRAY_BUFFER: 'ARRAY_BUFFER',
    ELEMENT_ARRAY_BUFFER: 'ELEMENT_ARRAY_BUFFER',
    TRIANGLES: 'TRIANGLES',
    TEXTURE0: 'TEXTURE0',
};

// Mock camera
const mockCamera = {
    updateViewMatrix: jest.fn(),
    getViewMatrix: jest.fn(() => new Float32Array(16)),
};

// Mock canvas
const mockCanvas = {
    clientWidth: 800,
    clientHeight: 600,
};

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn();

describe('Scene', () => {
    let scene;
    let consoleLogSpy;
    let consoleTraceSpy;

    beforeAll(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleTraceSpy = jest.spyOn(console, 'trace').mockImplementation(() => {});
    });

    afterAll(() => {
        consoleLogSpy.mockRestore();
        consoleTraceSpy.mockRestore();
    });

    beforeEach(() => {
        requestAnimationFrame.mockClear();
        scene = createScene(mockGl, mockCanvas, mockCamera);
    });

    test('should initialize and return scene object', () => {
        expect(scene).toHaveProperty('start');
        expect(scene).toHaveProperty('updateProgramInfo');
        expect(scene).toHaveProperty('updateUserScript');
        expect(scene).toHaveProperty('loadGeometry');
        expect(scene).toHaveProperty('getDrawable');
    });

    test('updateProgramInfo should update the program info', () => {
        const newProgramInfo = { program: 'new program' };
        scene.updateProgramInfo(newProgramInfo);
        // We can't directly access the internal programInfo,
        // but we can check if the render loop is called without errors.
        scene.start();
        expect(requestAnimationFrame).toHaveBeenCalled();
    });

    test('updateUserScript should update the user script', () => {
        const newUserScript = {
            init: jest.fn(),
            update: jest.fn(),
        };
        scene.updateUserScript(newUserScript);
        scene.start();
        expect(newUserScript.init).toHaveBeenCalled();
    });

    test('loadGeometry should update the drawable', () => {
        const newDrawable = {
            buffers: {
                position: 'pos',
                normal: 'norm',
                indices: 'ind',
            },
            vertexCount: 36,
            indexType: 'UNSIGNED_SHORT',
        };
        scene.loadGeometry(newDrawable);
        expect(scene.getDrawable()).toBe(newDrawable);
        scene.start();
        expect(requestAnimationFrame).toHaveBeenCalled();
    });

    test('updateUserScript should not change the drawable', () => {
        const newDrawable = {
            buffers: {
                position: 'pos',
                normal: 'norm',
                indices: 'ind',
            },
            vertexCount: 36,
            indexType: 'UNSIGNED_SHORT',
        };
        scene.loadGeometry(newDrawable);

        const newUserScript = {
            init: jest.fn(),
            update: jest.fn(),
        };
        scene.updateUserScript(newUserScript);

        expect(scene.getDrawable()).toBe(newDrawable);
    });
});
