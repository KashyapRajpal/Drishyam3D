import { detectPlyKind } from '../scripts/engine/scene-ops.js';

const splatHeader = `ply
format binary_little_endian 1.0
element vertex 1000
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float rot_0
end_header
`;

const meshHeader = `ply
format binary_little_endian 1.0
element vertex 400002
property float x
property float y
property float z
element face 800000
property list uchar int vertex_indices
end_header
`;

const pointCloudHeader = `ply
format binary_little_endian 1.0
element vertex 100
property float x
property float y
property float z
end_header
`;

describe('detectPlyKind', () => {
  test('detects a 3DGS splat cloud from SH/rotation attributes', () => {
    expect(detectPlyKind(splatHeader)).toBe('splat');
  });

  test('detects a triangle mesh from a face element', () => {
    expect(detectPlyKind(meshHeader)).toBe('mesh');
  });

  test('falls back to splat for a bare xyz point cloud', () => {
    expect(detectPlyKind(pointCloudHeader)).toBe('splat');
  });
});
