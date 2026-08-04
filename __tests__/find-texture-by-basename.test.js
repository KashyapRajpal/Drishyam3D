import { findTextureByBasename } from '../scripts/engine/scene-ops.js';

function fakeFile(name) {
  return { name };
}

describe('findTextureByBasename', () => {
  test('matches an exact basename', () => {
    const model = fakeFile('Vase.ply');
    const files = [fakeFile('Vase.jpg'), fakeFile('readme.txt')];
    expect(findTextureByBasename(model, files)).toBe(files[0]);
  });

  test('matches a basename_suffix pattern (e.g. Artec "_0" texture)', () => {
    const model = fakeFile('Christmas Bear.ply');
    const files = [fakeFile('Christmas Bear_0.jpg'), fakeFile('license.txt')];
    expect(findTextureByBasename(model, files)).toBe(files[0]);
  });

  test('does not attach an unrelated image when multiple images are present', () => {
    const model = fakeFile('Bear.ply');
    const files = [fakeFile('OtherModel_diffuse.png'), fakeFile('Bear_diffuse.png'), fakeFile('random.jpg')];
    expect(findTextureByBasename(model, files)).toBe(files[1]);
  });

  test('returns null when no matching texture exists', () => {
    const model = fakeFile('Bear.ply');
    const files = [fakeFile('Unrelated.jpg'), fakeFile('notes.txt')];
    expect(findTextureByBasename(model, files)).toBeNull();
  });

  test('is case-sensitive on basename but tolerant of extension case', () => {
    const model = fakeFile('Bear.ply');
    const files = [fakeFile('Bear.JPG')];
    expect(findTextureByBasename(model, files)).toBe(files[0]);
  });
});
