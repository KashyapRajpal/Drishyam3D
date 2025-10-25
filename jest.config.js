module.exports = {
  transform: {
    '^.+\.js$': 'babel-jest',
  },
  testEnvironment: 'node',
  globals: {
    'WebGLRenderingContext': {
        'BYTE': 5120,
        'UNSIGNED_BYTE': 5121,
        'SHORT': 5122,
        'UNSIGNED_SHORT': 5123,
        'INT': 5124,
        'UNSIGNED_INT': 5125,
        'FLOAT': 5126,
    }
  }
};