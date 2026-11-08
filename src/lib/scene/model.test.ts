import { describe, expect, it } from 'vitest';
import { History, newId, parseScene, parseSceneJson } from './model';

const prop = {
  id: 'a',
  kind: 'prop',
  name: 'Crate',
  glb: 'Map/x.glb',
  position: [1, 2, 3],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true
};
const character = {
  id: 'b',
  kind: 'character',
  name: 'Hero',
  outfit: { version: 1, gender: 1, skin: 2, items: [{ id: '11400604' }] },
  clip: 'idle_a',
  position: [0, 0, 0],
  rotation: [0, 1, 0],
  scale: [1, 1, 1],
  visible: false
};

describe('parseScene', () => {
  it('accepts valid props and characters', () => {
    const scene = parseScene({ version: 1, objects: [prop, character] });
    expect(scene?.objects).toHaveLength(2);
    expect(scene?.objects[1].visible).toBe(false);
    expect(scene?.objects[1].clip).toBe('idle_a');
  });

  it('drops malformed objects but keeps valid ones', () => {
    const scene = parseScene({
      version: 1,
      objects: [prop, { ...prop, id: 'x', position: [1, 2] }, { ...prop, id: 'y', glb: '' }, { ...character, outfit: { version: 5 } }, 'nope']
    });
    expect(scene?.objects.map((o) => o.id)).toEqual(['a']);
  });

  it('regenerates missing or duplicate ids', () => {
    const scene = parseScene({ version: 1, objects: [prop, { ...prop }, { ...prop, id: undefined }] });
    const ids = scene!.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('rejects a wrong envelope or invalid json', () => {
    expect(parseScene({ version: 2, objects: [] })).toBeNull();
    expect(parseScene({ version: 1 })).toBeNull();
    expect(parseSceneJson('{oops')).toBeNull();
  });
});

describe('map objects', () => {
  it('need a numeric map id', () => {
    const map = { id: 'm', kind: 'map', name: 'Henesys', mapId: '02000076', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
    expect(parseScene({ version: 1, objects: [map] })?.objects[0].mapId).toBe('02000076');
    expect(parseScene({ version: 1, objects: [{ ...map, mapId: '../x' }] })?.objects).toEqual([]);
    expect(parseScene({ version: 1, objects: [{ ...map, mapId: undefined }] })?.objects).toEqual([]);
  });
});

describe('newId', () => {
  it('produces unique ids', () => {
    expect(new Set(Array.from({ length: 200 }, () => newId())).size).toBe(200);
  });
});

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History();
    h.record('s0');
    h.record('s1');
    expect(h.undo('s2')).toBe('s1');
    expect(h.undo('s1')).toBe('s0');
    expect(h.undo('s0')).toBeNull();
    expect(h.redo('s0')).toBe('s1');
    expect(h.redo('s1')).toBe('s2');
    expect(h.redo('s2')).toBeNull();
  });

  it('clears redo on a new record and ignores duplicate consecutive states', () => {
    const h = new History();
    h.record('a');
    h.record('a');
    expect(h.undo('b')).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    h.record('c');
    expect(h.canRedo).toBe(false);
  });

  it('caps its size', () => {
    const h = new History(2);
    h.record('1');
    h.record('2');
    h.record('3');
    expect(h.undo('4')).toBe('3');
    expect(h.undo('3')).toBe('2');
    expect(h.undo('2')).toBeNull();
  });
});
