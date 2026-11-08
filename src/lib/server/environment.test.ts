import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment';

const xml = (body: string) => `<?xml version="1.0"?><ms2>${body}</ms2>`;
const tria = xml(`
  <minimap><image name="x.dds" /></minimap>
  <fog color="199,237,255" near="5276" far="20000" />
  <clientProperty bgDay="BG_Tria.dds" />`);

describe('parseEnvironment', () => {
  it('reads the backdrop and the fog of a map', () => {
    expect(parseEnvironment(tria)).toEqual({
      background: 'Resource/Image/bg/BG_Tria.png',
      fog: { color: [199, 237, 255], near: 5276, far: 20000 }
    });
  });

  it('works with either one alone, and gives null for neither', () => {
    expect(parseEnvironment(xml('<fog color="1,2,3" near="0" far="2000" />'))).toEqual({
      fog: { color: [1, 2, 3], near: 0, far: 2000 }
    });
    expect(parseEnvironment(xml('<clientProperty bgDay="bg_cave_c.dds" />'))).toEqual({ background: 'Resource/Image/bg/bg_cave_c.png' });
    expect(parseEnvironment(xml('<minimap />'))).toBeNull();
    expect(parseEnvironment('')).toBeNull();
  });

  it('skips backdrops that are empty, Flash files, or have no converted image', () => {
    expect(parseEnvironment(xml('<clientProperty bgDay="" />'))).toBeNull();
    expect(parseEnvironment(xml('<clientProperty bgDay="bg_white.swf" />'))).toBeNull();
    expect(parseEnvironment(tria, () => false)).toEqual({ fog: { color: [199, 237, 255], near: 5276, far: 20000 } });
  });

  it('asks about the converted file with its path under converted/textures', () => {
    const asked: string[] = [];
    parseEnvironment(tria, (p) => (asked.push(p), true));
    expect(asked).toEqual(['Resource/Image/bg/BG_Tria.png']);
  });

  it('drops fog that cannot be used', () => {
    for (const fog of [
      '<fog color="1,2" near="0" far="10" />',
      '<fog color="1,2,300" near="0" far="10" />',
      '<fog color="1,2,3" near="10" far="10" />',
      '<fog color="1,2,3" near="-5" far="10" />',
      '<fog color="a,b,c" near="0" far="10" />',
      '<fog color="1,2,3" near="x" far="10" />',
      '<fog near="0" far="10" />'
    ]) {
      expect(parseEnvironment(xml(fog))).toBeNull();
    }
  });

  it('reads attributes in any order and ignores spacing', () => {
    expect(parseEnvironment(xml('<fog far="900" near="100" color=" 10, 20 ,30 "/>'))?.fog).toEqual({ color: [10, 20, 30], near: 100, far: 900 });
  });
});
