import { describe, expect, it } from 'vitest';
import { SceneState } from './store.svelte.js';
import { entity, loadJson } from './testing';

// Entities of every type, read by property name.
type Any = Record<string, any>;
const all = (s: SceneState) => s.nodes as unknown as Any[];
const node = (s: SceneState, id: string) => s.node(id) as unknown as Any | undefined;

const item = (id: string, slots: string[]) => ({ itemId: id, name: `item ${id}`, slots });

function sceneWithHero() {
  const s = new SceneState();
  const hero = s.addCharacter({ name: 'Hero', gender: 1 }, [item('1', ['CP']), item('2', ['CL'])]);
  return { s, hero };
}

const names = (s: SceneState, parentId: string | null) => all(s).filter((n) => n.parentId === parentId).map((n) => n.name);

describe('SceneState add', () => {
  it('adds nodes with unique sibling names and selects them', () => {
    const s = new SceneState();
    const a = s.add({ type: 'group', name: 'Group' });
    const b = s.add({ type: 'group', name: 'Group' });
    expect(names(s, null)).toEqual(['Group', 'Group 2']);
    expect(s.selectedId).toBe(b);
    expect(a).not.toBe(b);
  });

  it('keeps items on characters only and nothing on items', () => {
    const { s, hero } = sceneWithHero();
    const prop = s.add({ type: 'prop', name: 'Crate', glb: 'a.glb' });
    expect(s.add({ type: 'item', name: 'x', itemId: '9', parentId: prop })).toBe('');
    expect(s.add({ type: 'item', name: 'x', itemId: '9' })).toBe('');
    const hat = all(s).find((n) => n.itemId === '1')!;
    const child = s.add({ type: 'prop', name: 'Spark', glb: 'b.glb', parentId: hat.id });
    expect(node(s, child)?.parentId).toBeNull();
    expect(s.add({ type: 'item', name: 'ok', itemId: '3', slots: ['GL'], parentId: hero })).not.toBe('');
  });

  it('append adds ready-made entities in one undo step', () => {
    const s = new SceneState();
    s.append([entity('g', 'group'), entity('a', 'prop', 'g'), entity('b', 'prop', 'g')]);
    expect(all(s).filter((n) => n.parentId === 'g')).toHaveLength(2);
    s.undo();
    expect(all(s)).toHaveLength(0);
  });
});

describe('SceneState equipItem', () => {
  it('replaces an item that takes the same slot, in one undo step', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, item('5', ['CL']));
    expect(all(s).filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['1', '5']);
    s.undo();
    expect(all(s).filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['1', '2']);
  });

  it('replaces the same item (a colour change) instead of duplicating it', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, { ...item('1', ['CP']), color: 4 });
    const hats = all(s).filter((n) => n.itemId === '1');
    expect(hats).toHaveLength(1);
    expect(hats[0].color).toBe(4);
  });

  it('refuses non-characters', () => {
    const s = new SceneState();
    const g = s.add({ type: 'group', name: 'G' });
    expect(s.equipItem(g, item('1', ['CP']))).toBe('');
  });

  it('setOutfit replaces everything worn', () => {
    const { s, hero } = sceneWithHero();
    s.setOutfit(hero, [item('7', ['SH'])]);
    expect(all(s).filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['7']);
  });
});

describe('SceneState character eyes', () => {
  it('gives characters the default eye colour unless one is given', () => {
    const s = new SceneState();
    const a = s.addCharacter({ name: 'A', gender: 1 });
    const b = s.addCharacter({ name: 'B', gender: 0, eye: 9 });
    expect(node(s, a)?.eye).toBe(5);
    expect(node(s, b)?.eye).toBe(9);
  });
});

describe('SceneState per-channel colours', () => {
  it('stores picks on the item node and replaces them with the item', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, { ...item('1', ['CP']), color: 2, channelColors: { ch0: 4, ch2: 7 } });
    const hat = all(s).find((n) => n.itemId === '1')!;
    expect(hat).toMatchObject({ color: 2, channelColors: { ch0: 4, ch2: 7 } });
    s.equipItem(hero, item('1', ['CP']));
    expect(all(s).find((n) => n.itemId === '1')?.channelColors).toBeUndefined();
  });

  it('leaves out empty picks and survives duplicating the character', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, { ...item('9', ['GL']), channelColors: {} });
    expect(all(s).find((n) => n.itemId === '9')?.channelColors).toBeUndefined();
    s.equipItem(hero, { ...item('10', ['SH']), channelColors: { ch2: 3 } });
    const copy = s.duplicate(hero)!;
    expect(all(s).find((n) => n.parentId === copy && n.itemId === '10')?.channelColors).toEqual({ ch2: 3 });
  });

  it('setOutfit and addCharacter carry the picks', () => {
    const s = new SceneState();
    const id = s.addCharacter({ name: 'A', gender: 1 }, [{ ...item('1', ['CP']), channelColors: { ch0: 1 } }]);
    expect(all(s).find((n) => n.parentId === id)?.channelColors).toEqual({ ch0: 1 });
    s.setOutfit(id, [{ ...item('2', ['CL']), channelColors: { ch2: 2 } }]);
    expect(all(s).find((n) => n.parentId === id)?.channelColors).toEqual({ ch2: 2 });
  });
});

describe('SceneState remove, duplicate, group', () => {
  it('removes a node with its subtree and fixes the selection', () => {
    const { s, hero } = sceneWithHero();
    s.select(all(s).find((n) => n.itemId === '1')!.id);
    s.remove(hero);
    expect(all(s)).toHaveLength(0);
    expect(s.selectedId).toBeNull();
  });

  it('duplicates a character with its items, but not a lone item', () => {
    const { s, hero } = sceneWithHero();
    const copy = s.duplicate(hero)!;
    expect(all(s)).toHaveLength(6);
    expect(all(s).filter((n) => n.parentId === copy)).toHaveLength(2);
    expect(s.duplicate(all(s).find((n) => n.itemId === '1')!.id)).toBeNull();
  });

  it('groups a node in a new group that takes its place', () => {
    const s = new SceneState();
    const a = s.add({ type: 'prop', name: 'A', glb: 'a.glb' });
    const b = s.add({ type: 'prop', name: 'B', glb: 'b.glb' });
    const g = s.group(b)!;
    expect(all(s).map((n) => n.id)).toEqual([a, g, b]);
    expect(node(s, b)?.parentId).toBe(g);
    expect(s.selectedId).toBe(g);
    expect(s.group(all(s).find((n) => n.type === 'prop' && n.id === a)!.id)).not.toBeNull();
  });
});

describe('SceneState reparent', () => {
  it('moves a node, inserts before a sibling and applies the world-preserving transform', () => {
    const s = new SceneState();
    const g = s.add({ type: 'group', name: 'G' });
    const a = s.add({ type: 'prop', name: 'A', glb: 'a.glb', position: [5, 0, 0] });
    const b = s.add({ type: 'prop', name: 'B', glb: 'b.glb', parentId: g });
    s.hooks.localFor = (id, parentId) => ({ position: [id === a && parentId === g ? 1 : 0, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(s.reparent(a, g, { beforeId: b })).toBe(true);
    expect(names(s, g)).toEqual(['A', 'B']);
    expect(node(s, a)?.position).toEqual([1, 2, 3]);
  });

  it('mounts on a bone of a character and rejects forbidden moves', () => {
    const { s, hero } = sceneWithHero();
    const prop = s.add({ type: 'prop', name: 'Sword', glb: 's.glb' });
    expect(s.reparent(prop, hero, { bone: 'Bip01_R_Hand' })).toBe(true);
    expect(node(s, prop)).toMatchObject({ parentId: hero, attachBone: 'Bip01_R_Hand' });
    expect(s.reparent(hero, prop)).toBe(false); // the prop now lives below the hero
    const hat = all(s).find((n) => n.itemId === '1')!;
    expect(s.reparent(hat.id, null)).toBe(false);
  });

  it('resets an item offset when it moves to another character', () => {
    const { s, hero } = sceneWithHero();
    const other = s.addCharacter({ name: 'Other', gender: 0 });
    const hat = all(s).find((n) => n.itemId === '1')!;
    s.update(hat.id, { position: [4, 5, 6] });
    expect(s.reparent(hat.id, other)).toBe(true);
    expect(node(s, hat.id)).toMatchObject({ parentId: other, position: [0, 0, 0] });
    expect(names(s, hero)).toEqual(['item 2']);
  });
});

describe('SceneState updatePositions', () => {
  it('updates multiple nodes in one undo step', () => {
    const s = new SceneState();
    const group = s.add({ type: 'group', name: 'Group' });
    const child = s.add({ type: 'prop', name: 'Child', glb: 'child.glb', parentId: group });
    s.updatePositions([
      { id: group, position: [10, 20, 30] },
      { id: child, position: [-10, -20, -30] }
    ]);

    expect(node(s, group)?.position).toEqual([10, 20, 30]);
    expect(node(s, child)?.position).toEqual([-10, -20, -30]);
    s.undo();
    expect(node(s, group)?.position).toEqual([0, 0, 0]);
    expect(node(s, child)?.position).toEqual([0, 0, 0]);
  });
});

describe('SceneState history and persistence', () => {
  it('undoes and redoes node changes', () => {
    const s = new SceneState();
    const a = s.add({ type: 'group', name: 'G' });
    s.update(a, { name: 'Renamed' });
    expect(node(s, a)?.name).toBe('Renamed');
    s.undo();
    expect(node(s, a)?.name).toBe('G');
    s.redo();
    expect(node(s, a)?.name).toBe('Renamed');
    s.undo();
    s.undo();
    expect(all(s)).toHaveLength(0);
  });

  it('rename ignores blanks and unchanged names', () => {
    const s = new SceneState();
    const a = s.add({ type: 'group', name: 'G' });
    s.rename(a, '  ');
    s.rename(a, 'G');
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.canUndo).toBe(false);
  });

  it('round-trips through storage and JSON, saving each entity with its type', () => {
    const { s } = sceneWithHero();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    s.saveLocal(storage);
    const t = new SceneState();
    expect(loadJson(t, storage.getItem('ms2se.scene.current')!)).toBe(true);
    expect(JSON.stringify(t.nodes)).toEqual(JSON.stringify(s.nodes));
    const u = new SceneState();
    expect(loadJson(u, 'nope')).toBe(false);
    expect(loadJson(u, s.serialize())).toBe(true);
    expect(all(u)).toHaveLength(3);
    expect(JSON.parse(s.serialize())).toMatchObject({ version: 3, entities: [{ type: 'character' }, { type: 'item' }, { type: 'item' }] });
  });

  it('selecting a bone clears the node selection and back', () => {
    const { s, hero } = sceneWithHero();
    s.select(hero);
    s.selectBone(hero, 'Bip01_Head');
    expect(s.selectedId).toBeNull();
    expect(s.selectedBone).toEqual({ characterId: hero, bone: 'Bip01_Head' });
    s.select(hero);
    expect(s.selectedBone).toBeNull();
    s.selectBone(hero, 'Bip01_Head');
    s.remove(hero);
    expect(s.selectedBone).toBeNull();
  });
});
