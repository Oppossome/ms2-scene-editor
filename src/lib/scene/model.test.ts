import { describe, expect, it } from 'vitest';
import { History, nodesToOutfit, parseScene, parseSceneJson, type SceneNode } from './model';

const base = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
const node = (o: Record<string, unknown>) => ({ ...base, name: 'n', ...o });

const hero = node({ id: 'hero', kind: 'character', gender: 1, skin: 3 });
const hat = node({ id: 'hat', kind: 'item', parentId: 'hero', itemId: '11400604', slots: ['CP'], color: 2 });
const crate = node({ id: 'crate', kind: 'prop', glb: 'Map/x.glb' });

describe('parseScene', () => {
  it('accepts a tree with items under a character', () => {
    const scene = parseScene({ version: 1, nodes: [hero, hat, crate] });
    expect(scene?.nodes.map((n) => n.id)).toEqual(['hero', 'hat', 'crate']);
    expect(scene?.nodes[1]).toMatchObject({ parentId: 'hero', itemId: '11400604', color: 2, slots: ['CP'] });
    expect(scene?.nodes[0]).toMatchObject({ gender: 1, skin: 3, locked: false });
  });

  it('rejects a wrong envelope and the old flat format', () => {
    expect(parseScene(null)).toBeNull();
    expect(parseScene({ version: 2, nodes: [] })).toBeNull();
    expect(parseScene({ version: 1, objects: [crate] })).toBeNull();
  });

  it('drops invalid nodes', () => {
    const scene = parseScene({
      version: 1,
      nodes: [
        crate,
        node({ id: 'a', kind: 'prop' }), // no model
        node({ id: 'b', kind: 'wat', glb: 'x' }),
        node({ id: 'c', kind: 'map', mapId: 'abc' }),
        node({ id: 'd', kind: 'character', gender: 5 }),
        { ...crate, id: 'e', position: [1, 2] }
      ]
    });
    expect(scene?.nodes.map((n) => n.id)).toEqual(['crate']);
  });

  it('repairs parent links', () => {
    const scene = parseScene({
      version: 1,
      nodes: [
        node({ id: 'a', kind: 'group', parentId: 'missing' }),
        node({ id: 'b', kind: 'group', parentId: 'c' }),
        node({ id: 'c', kind: 'group', parentId: 'b' }),
        node({ id: 'd', kind: 'group', parentId: 'crate' }), // crate is a prop: props may hold children
        crate
      ]
    });
    const byId = new Map(scene!.nodes.map((n) => [n.id, n]));
    expect(byId.get('a')?.parentId).toBeNull();
    // a cycle is cut somewhere, so walking up always terminates at the root
    for (const id of ['b', 'c']) {
      let cur = byId.get(id);
      for (let i = 0; i < 5 && cur?.parentId; i++) cur = byId.get(cur.parentId);
      expect(cur?.parentId).toBeNull();
    }
    expect(byId.get('d')?.parentId).toBe('crate');
  });

  it('drops items that are not on a character and moves children off items', () => {
    const scene = parseScene({
      version: 1,
      nodes: [
        hero,
        hat,
        node({ id: 'loose', kind: 'item', itemId: '1', slots: [] }),
        node({ id: 'onprop', kind: 'item', parentId: 'crate', itemId: '2', slots: [] }),
        crate,
        node({ id: 'child', kind: 'prop', glb: 'a.glb', parentId: 'hat', attachBone: 'Bip01' })
      ]
    });
    expect(scene?.nodes.map((n) => n.id).sort()).toEqual(['child', 'crate', 'hat', 'hero']);
    const child = scene!.nodes.find((n) => n.id === 'child')!;
    expect(child.parentId).toBeNull();
    expect(child.attachBone).toBeUndefined();
  });

  it('keeps attachBone only on children of characters', () => {
    const scene = parseScene({
      version: 1,
      nodes: [hero, node({ id: 'sword', kind: 'prop', glb: 's.glb', parentId: 'hero', attachBone: 'Bip01 R Hand' }), crate, node({ id: 'x', kind: 'prop', glb: 'q.glb', parentId: 'crate', attachBone: 'B' })]
    });
    expect(scene!.nodes.find((n) => n.id === 'sword')?.attachBone).toBe('Bip01 R Hand');
    expect(scene!.nodes.find((n) => n.id === 'x')?.attachBone).toBeUndefined();
  });

  it('renames duplicate ids', () => {
    const scene = parseScene({ version: 1, nodes: [crate, { ...crate }] });
    expect(new Set(scene!.nodes.map((n) => n.id)).size).toBe(2);
  });

  it('parseSceneJson handles bad JSON', () => {
    expect(parseSceneJson('{nope')).toBeNull();
    expect(parseSceneJson(JSON.stringify({ version: 1, nodes: [crate] }))?.nodes).toHaveLength(1);
  });
});

describe('per-channel colours', () => {
  it('parses valid channel picks on items and drops invalid ones', () => {
    const ok = parseScene({ version: 1, nodes: [hero, { ...hat, channelColors: { ch0: 3, ch2: 1, ch1: -4, junk: 9 } }] })!;
    expect(ok.nodes.find((n) => n.id === 'hat')?.channelColors).toEqual({ ch0: 3, ch2: 1 });
    const none = parseScene({ version: 1, nodes: [hero, { ...hat, channelColors: { ch0: 'x' } }] })!;
    expect(none.nodes.find((n) => n.id === 'hat')?.channelColors).toBeUndefined();
  });

  it('keeps the picks in a saved outfit snapshot', () => {
    const scene = parseScene({ version: 1, nodes: [hero, { ...hat, channelColors: { ch2: 5 } }] })!;
    expect(nodesToOutfit(scene.nodes, 'hero')?.items).toEqual([{ id: '11400604', color: 2, channels: { ch2: 5 } }]);
  });
});

describe('nodesToOutfit', () => {
  it('lists the item children of a character in order', () => {
    const scene = parseScene({
      version: 1,
      nodes: [hero, hat, node({ id: 'top', kind: 'item', parentId: 'hero', itemId: '5', slots: ['CL'] }), crate]
    })!;
    expect(nodesToOutfit(scene.nodes, 'hero')).toEqual({
      version: 1,
      gender: 1,
      skin: 3,
      eye: 5,
      items: [{ id: '11400604', color: 2 }, { id: '5' }]
    });
  });

  it('keeps a valid freeze frame and drops others', () => {
    expect(parseScene({ version: 1, nodes: [{ ...hero, freeze: 12 }] })!.nodes[0].freeze).toBe(12);
    expect(parseScene({ version: 1, nodes: [{ ...hero, freeze: 0 }] })!.nodes[0].freeze).toBe(0);
    for (const bad of [-1, 1.5, 'x', null]) expect(parseScene({ version: 1, nodes: [{ ...hero, freeze: bad }] })!.nodes[0].freeze).toBeUndefined();
  });

  it('keeps a character\'s eye colour, defaulting and repairing it when missing or invalid', () => {
    const eyed = parseScene({ version: 1, nodes: [{ ...hero, eye: 9 }] })!;
    expect(eyed.nodes[0].eye).toBe(9);
    expect(nodesToOutfit(eyed.nodes, 'hero')?.eye).toBe(9);
    expect(parseScene({ version: 1, nodes: [hero] })!.nodes[0].eye).toBe(5);
    expect(parseScene({ version: 1, nodes: [{ ...hero, eye: -1 }] })!.nodes[0].eye).toBe(5);
  });

  it('is null for non-characters', () => {
    const nodes = parseScene({ version: 1, nodes: [crate] })!.nodes as SceneNode[];
    expect(nodesToOutfit(nodes, 'crate')).toBeNull();
    expect(nodesToOutfit(nodes, 'nope')).toBeNull();
  });
});

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History();
    h.record('a');
    h.record('b');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    expect(h.canRedo).toBe(true);
  });

  it('drops redo on a new record and honours the limit', () => {
    const h = new History(2);
    h.record('a');
    h.record('b');
    h.record('c');
    expect(h.undo('d')).toBe('c');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBeNull();
    h.record('x');
    expect(h.canRedo).toBe(false);
  });
});
