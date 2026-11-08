import { describe, expect, it } from 'vitest';
import { SceneState } from './store.svelte';

const item = (id: string, slots: string[]) => ({ itemId: id, name: `item ${id}`, slots });

function sceneWithHero() {
  const s = new SceneState();
  const hero = s.addCharacter({ name: 'Hero', gender: 1 }, [item('1', ['CP']), item('2', ['CL'])]);
  return { s, hero };
}

const names = (s: SceneState, parentId: string | null) => s.nodes.filter((n) => n.parentId === parentId).map((n) => n.name);

describe('SceneState add', () => {
  it('adds nodes with unique sibling names and selects them', () => {
    const s = new SceneState();
    const a = s.add({ kind: 'group', name: 'Group' });
    const b = s.add({ kind: 'group', name: 'Group' });
    expect(names(s, null)).toEqual(['Group', 'Group 2']);
    expect(s.selectedId).toBe(b);
    expect(a).not.toBe(b);
  });

  it('keeps items on characters only and nothing on items', () => {
    const { s, hero } = sceneWithHero();
    const prop = s.add({ kind: 'prop', name: 'Crate', glb: 'a.glb' });
    expect(s.add({ kind: 'item', name: 'x', itemId: '9', parentId: prop })).toBe('');
    expect(s.add({ kind: 'item', name: 'x', itemId: '9' })).toBe('');
    const hat = s.nodes.find((n) => n.itemId === '1')!;
    const child = s.add({ kind: 'prop', name: 'Spark', glb: 'b.glb', parentId: hat.id });
    expect(s.node(child)?.parentId).toBeNull();
    expect(s.add({ kind: 'item', name: 'ok', itemId: '3', slots: ['GL'], parentId: hero })).not.toBe('');
  });

  it('addMany links a batch through parentIndex in one undo step', () => {
    const s = new SceneState();
    const ids = s.addMany([
      { kind: 'group', name: 'G' },
      { kind: 'prop', name: 'A', glb: 'a.glb', parentIndex: 0 },
      { kind: 'prop', name: 'B', glb: 'b.glb', parentIndex: 0 }
    ]);
    expect(s.nodes.filter((n) => n.parentId === ids[0])).toHaveLength(2);
    s.undo();
    expect(s.nodes).toHaveLength(0);
  });
});

describe('SceneState equipItem', () => {
  it('replaces an item that takes the same slot, in one undo step', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, item('5', ['CL']));
    expect(s.nodes.filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['1', '5']);
    s.undo();
    expect(s.nodes.filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['1', '2']);
  });

  it('replaces the same item (a colour change) instead of duplicating it', () => {
    const { s, hero } = sceneWithHero();
    s.equipItem(hero, { ...item('1', ['CP']), color: 4 });
    const hats = s.nodes.filter((n) => n.itemId === '1');
    expect(hats).toHaveLength(1);
    expect(hats[0].color).toBe(4);
  });

  it('refuses non-characters', () => {
    const s = new SceneState();
    const g = s.add({ kind: 'group', name: 'G' });
    expect(s.equipItem(g, item('1', ['CP']))).toBe('');
  });

  it('setOutfit replaces everything worn', () => {
    const { s, hero } = sceneWithHero();
    s.setOutfit(hero, [item('7', ['SH'])]);
    expect(s.nodes.filter((n) => n.parentId === hero).map((n) => n.itemId)).toEqual(['7']);
  });
});

describe('SceneState remove, duplicate, group', () => {
  it('removes a node with its subtree and fixes the selection', () => {
    const { s, hero } = sceneWithHero();
    s.select(s.nodes.find((n) => n.itemId === '1')!.id);
    s.remove(hero);
    expect(s.nodes).toHaveLength(0);
    expect(s.selectedId).toBeNull();
  });

  it('duplicates a character with its items, but not a lone item', () => {
    const { s, hero } = sceneWithHero();
    const copy = s.duplicate(hero)!;
    expect(s.nodes).toHaveLength(6);
    expect(s.nodes.filter((n) => n.parentId === copy)).toHaveLength(2);
    expect(s.duplicate(s.nodes.find((n) => n.itemId === '1')!.id)).toBeNull();
  });

  it('groups a node in a new group that takes its place', () => {
    const s = new SceneState();
    const a = s.add({ kind: 'prop', name: 'A', glb: 'a.glb' });
    const b = s.add({ kind: 'prop', name: 'B', glb: 'b.glb' });
    const g = s.group(b)!;
    expect(s.nodes.map((n) => n.id)).toEqual([a, g, b]);
    expect(s.node(b)?.parentId).toBe(g);
    expect(s.selectedId).toBe(g);
    expect(s.group(s.nodes.find((n) => n.kind === 'prop' && n.id === a)!.id)).not.toBeNull();
  });
});

describe('SceneState reparent', () => {
  it('moves a node, inserts before a sibling and applies the world-preserving transform', () => {
    const s = new SceneState();
    const g = s.add({ kind: 'group', name: 'G' });
    const a = s.add({ kind: 'prop', name: 'A', glb: 'a.glb', position: [5, 0, 0] });
    const b = s.add({ kind: 'prop', name: 'B', glb: 'b.glb', parentId: g });
    s.hooks.localFor = (id, parentId) => ({ position: [id === a && parentId === g ? 1 : 0, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(s.reparent(a, g, { beforeId: b })).toBe(true);
    expect(names(s, g)).toEqual(['A', 'B']);
    expect(s.node(a)?.position).toEqual([1, 2, 3]);
  });

  it('mounts on a bone of a character and rejects forbidden moves', () => {
    const { s, hero } = sceneWithHero();
    const prop = s.add({ kind: 'prop', name: 'Sword', glb: 's.glb' });
    expect(s.reparent(prop, hero, { bone: 'Bip01_R_Hand' })).toBe(true);
    expect(s.node(prop)).toMatchObject({ parentId: hero, attachBone: 'Bip01_R_Hand' });
    expect(s.reparent(hero, prop)).toBe(false); // the prop now lives below the hero
    const hat = s.nodes.find((n) => n.itemId === '1')!;
    expect(s.reparent(hat.id, null)).toBe(false);
  });

  it('resets an item offset when it moves to another character', () => {
    const { s, hero } = sceneWithHero();
    const other = s.addCharacter({ name: 'Other', gender: 0 });
    const hat = s.nodes.find((n) => n.itemId === '1')!;
    s.update(hat.id, { position: [4, 5, 6] });
    expect(s.reparent(hat.id, other)).toBe(true);
    expect(s.node(hat.id)).toMatchObject({ parentId: other, position: [0, 0, 0] });
    expect(names(s, hero)).toEqual(['item 2']);
  });
});

describe('SceneState history and persistence', () => {
  it('undoes and redoes node changes', () => {
    const s = new SceneState();
    const a = s.add({ kind: 'group', name: 'G' });
    s.update(a, { name: 'Renamed' });
    expect(s.node(a)?.name).toBe('Renamed');
    s.undo();
    expect(s.node(a)?.name).toBe('G');
    s.redo();
    expect(s.node(a)?.name).toBe('Renamed');
    s.undo();
    s.undo();
    expect(s.nodes).toHaveLength(0);
  });

  it('rename ignores blanks and unchanged names', () => {
    const s = new SceneState();
    const a = s.add({ kind: 'group', name: 'G' });
    s.rename(a, '  ');
    s.rename(a, 'G');
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.canUndo).toBe(false);
  });

  it('round-trips through storage and JSON', () => {
    const { s } = sceneWithHero();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    s.saveLocal(storage);
    const t = new SceneState();
    t.loadLocal(storage);
    expect(t.nodes).toEqual(s.nodes);
    expect(t.canUndo).toBe(false);
    const u = new SceneState();
    expect(u.loadJson('nope')).toBe(false);
    expect(u.loadJson(JSON.stringify(s.toData()))).toBe(true);
    expect(u.nodes).toHaveLength(3);
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
