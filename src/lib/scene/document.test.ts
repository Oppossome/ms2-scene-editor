import { describe, expect, it } from 'vitest';
import { parseScene, parseSceneJson } from './document';
import { CharacterEntity, GroupEntity, ItemEntity, LightingEntity, NpcEntity, PropEntity, restoreEntity } from './entity.svelte';

// Versions 1 and 2 saved `nodes` tagged with `kind`.
const base = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
const node = (o: Record<string, unknown>) => ({ ...base, name: 'n', ...o });
const v1 = (...nodes: unknown[]) => ({ version: 1, nodes });

const hero = node({ id: 'hero', kind: 'character', gender: 1, skin: 3 });
const hat = node({ id: 'hat', kind: 'item', parentId: 'hero', itemId: '11400604', slots: ['CP'], color: 2 });
const crate = node({ id: 'crate', kind: 'prop', glb: 'Map/x.glb' });
const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);

describe('legacy scenes (versions 1 and 2)', () => {
  it('accepts a tree with items under a character', () => {
    const doc = parseScene(v1(hero, hat, crate))!;
    expect(ids(doc.entities)).toEqual(['hero', 'hat', 'crate']);
    expect(doc.entities[0]).toBeInstanceOf(CharacterEntity);
    expect(doc.entities[1]).toMatchObject({ parentId: 'hero', itemId: '11400604', color: 2, slots: ['CP'] });
    expect(doc.entities[0]).toMatchObject({ gender: 1, skin: 3, locked: false });
  });

  it('rejects a wrong envelope and the old flat format', () => {
    const issues: string[] = [];
    expect(parseScene(null)).toBeNull();
    expect(parseScene({ version: 4, nodes: [] }, issues)).toBeNull();
    expect(issues[0]).toMatch(/version/);
    expect(parseScene({ version: 1, objects: [crate] })).toBeNull();
    expect(parseScene({ version: 3, nodes: [] })).toBeNull();
  });

  it('drops entities that cannot be restored and says why', () => {
    const issues: string[] = [];
    const doc = parseScene(v1(
      crate,
      node({ id: 'a', kind: 'prop' }), // no model
      node({ id: 'b', kind: 'wat', glb: 'x' }),
      node({ id: 'c', kind: 'map', mapId: 'abc' }),
      node({ id: 'd', kind: 'character', gender: 5 }),
      { ...crate, id: 'e', position: [1, 2] },
      'not an object'
    ), issues)!;
    expect(ids(doc.entities)).toEqual(['crate']);
    expect(issues.join('\n')).toMatch(/nodes\.1: glb/);
    expect(issues.join('\n')).toMatch(/nodes\.2: Unknown entity type: wat/);
    expect(issues.join('\n')).toMatch(/nodes\.5: position/);
  });

  it('uses defaults for unusable optional values instead of dropping the entity', () => {
    const doc = parseScene(v1({ ...hero, skin: -1, eye: 'x', expression: '../file', clip: '', speed: 0, freeze: 1.5, name: '', visible: 'yes', locked: 1 }))!;
    expect(doc.entities[0]).toMatchObject({ skin: 2, eye: 5, name: 'character', visible: true, locked: false });
    expect(doc.entities[0]).toMatchObject({ expression: undefined, clip: undefined, speed: undefined, freeze: undefined });
  });

  it('keeps a valid freeze frame, speed and expression', () => {
    expect(parseScene(v1({ ...hero, freeze: 12 }))!.entities[0]).toMatchObject({ freeze: 12 });
    expect(parseScene(v1({ ...hero, freeze: 0 }))!.entities[0]).toMatchObject({ freeze: 0 });
    expect(parseScene(v1({ ...hero, expression: 'smile', speed: 2 }))!.entities[0]).toMatchObject({ expression: 'smile', speed: 2 });
  });

  it('repairs parent links', () => {
    const issues: string[] = [];
    const doc = parseScene(v1(
      node({ id: 'a', kind: 'group', parentId: 'missing' }),
      node({ id: 'b', kind: 'group', parentId: 'c' }),
      node({ id: 'c', kind: 'group', parentId: 'b' }),
      node({ id: 'd', kind: 'group', parentId: 'crate' }), // props may hold children
      crate
    ), issues)!;
    const byId = new Map(doc.entities.map((e) => [e.id, e]));
    expect(byId.get('a')?.parentId).toBeNull();
    for (const id of ['b', 'c']) {
      let cur = byId.get(id);
      for (let i = 0; i < 5 && cur?.parentId; i++) cur = byId.get(cur.parentId);
      expect(cur?.parentId).toBeNull();
    }
    expect(byId.get('d')?.parentId).toBe('crate');
    expect(issues.join('\n')).toMatch(/missing parent/);
    expect(issues.join('\n')).toMatch(/cycle/);
  });

  it('drops items that are not on a character and moves children off items', () => {
    const doc = parseScene(v1(
      hero, hat,
      node({ id: 'loose', kind: 'item', itemId: '1', slots: [] }),
      node({ id: 'onprop', kind: 'item', parentId: 'crate', itemId: '2', slots: [] }),
      crate,
      node({ id: 'child', kind: 'prop', glb: 'a.glb', parentId: 'hat', attachBone: 'Bip01' })
    ))!;
    expect(ids(doc.entities).sort()).toEqual(['child', 'crate', 'hat', 'hero']);
    const child = doc.entities.find((e) => e.id === 'child')!;
    expect(child.parentId).toBeNull();
    expect(child.attachBone).toBeUndefined();
  });

  it('keeps attachBone only on children of characters', () => {
    const doc = parseScene(v1(
      hero, node({ id: 'sword', kind: 'prop', glb: 's.glb', parentId: 'hero', attachBone: 'Bip01 R Hand' }),
      crate, node({ id: 'x', kind: 'prop', glb: 'q.glb', parentId: 'crate', attachBone: 'B' })
    ))!;
    expect(doc.entities.find((e) => e.id === 'sword')?.attachBone).toBe('Bip01 R Hand');
    expect(doc.entities.find((e) => e.id === 'x')?.attachBone).toBeUndefined();
  });

  it('renames duplicate ids', () => {
    const issues: string[] = [];
    const doc = parseScene(v1(crate, { ...crate }), issues)!;
    expect(new Set(ids(doc.entities)).size).toBe(2);
    expect(issues.join('\n')).toMatch(/duplicate id/);
  });

  it('parses per-channel colour picks on items and drops invalid ones', () => {
    const ok = parseScene(v1(hero, { ...hat, channelColors: { ch0: 3, ch2: 1, ch1: -4, junk: 9 } }))!;
    expect(ok.entities[1]).toMatchObject({ channelColors: { ch0: 3, ch2: 1 } });
    expect((parseScene(v1(hero, { ...hat, channelColors: { ch0: 'x' } }))!.entities[1] as ItemEntity).channelColors).toBeUndefined();
  });

  it('reads a map saved as one node as a group still to be expanded', () => {
    const doc = parseScene(v1(node({ id: 'm', kind: 'map', mapId: '2000001' }), node({ id: 'k', kind: 'group', parentId: 'm' })))!;
    expect(doc.entities[0]).toBeInstanceOf(GroupEntity);
    expect(doc.entities[0]).toMatchObject({ mapId: '2000001' });
    expect(doc.pendingMaps).toEqual([doc.entities[0]]);
  });

  it('only accepts Lighting from version 2', () => {
    const lighting = node({ id: 'l', kind: 'lighting', environment: { background: 'a.png' } });
    expect(parseScene(v1(lighting))!.entities).toHaveLength(0);
    expect(parseScene({ version: 2, nodes: [lighting] })!.entities[0]).toBeInstanceOf(LightingEntity);
  });

  it('parseSceneJson handles bad JSON', () => {
    const issues: string[] = [];
    expect(parseSceneJson('{nope', issues)).toBeNull();
    expect(issues[0]).toMatch(/Invalid JSON/);
    expect(parseSceneJson(JSON.stringify(v1(crate)))?.entities).toHaveLength(1);
  });
});

describe('type-tagged scenes (version 3)', () => {
  const kinds = [
    { type: 'group', mapId: '12' },
    { type: 'prop', glb: 'x.glb', instanced: true, clip: 'spin', speed: 2, freeze: 4 },
    { type: 'npc', glb: 'n.glb' },
    { type: 'character', gender: 0, skin: 4, eye: 7, expression: 'smile' },
    { type: 'item', itemId: '9', slots: ['CP'], color: 3, channelColors: { ch0: 1 } },
    { type: 'lighting', environment: { background: 'bg.png', fog: { color: [1, 2, 3], near: 4, far: 9 } } }
  ].map((e, i) => ({ id: `e${i}`, name: e.type, parentId: null, ...base, locked: false, ...e }));

  it('restores each type as its class from the type tag, and saves the same JSON back', () => {
    const items = kinds.map((k) => (k.type === 'item' ? { ...k, parentId: 'e3' } : k));
    const doc = parseScene({ version: 3, entities: items })!;
    expect(doc.entities.map((e) => e.constructor)).toEqual([GroupEntity, PropEntity, NpcEntity, CharacterEntity, ItemEntity, LightingEntity]);
    expect(doc.entities.map((e) => e.toJSON())).toEqual(items);
    expect(doc.pendingMaps).toEqual([]);
    expect(JSON.parse(JSON.stringify(doc.entities))).toEqual(items);
  });

  it('writes only registered values and the type, never runtime state', () => {
    const json = restoreEntity({ type: 'prop', glb: 'x.glb', ...base }).toJSON();
    expect(Object.keys(json).sort()).toEqual(['glb', 'id', 'locked', 'name', 'parentId', 'position', 'rotation', 'scale', 'type', 'visible']);
  });

  it('does not accept a kind or an unknown type, and cannot name a constructor', () => {
    const issues: string[] = [];
    const doc = parseScene({ version: 3, entities: [
      { ...base, kind: 'group' }, { ...base, type: 'Object' }, { ...base, type: 'constructor' }, { ...base, type: '__proto__' },
      { ...base, type: 'group', id: 'ok' }
    ] }, issues)!;
    expect(ids(doc.entities)).toEqual(['ok']);
    expect(issues).toHaveLength(4);
  });

  it('keeps usable siblings when an entity is invalid, with field paths', () => {
    const issues: string[] = [];
    const doc = parseScene({ version: 3, entities: [
      { type: 'group', id: 'a', name: 'A', ...base },
      { type: 'prop', id: 'b', glb: 'x.glb', ...base, position: [NaN, 0, 0] },
      { type: 'character', id: 'c', name: 'C', ...base, gender: 1, skin: 'x' }
    ] }, issues)!;
    expect(ids(doc.entities)).toEqual(['a', 'c']);
    expect(doc.entities[1]).toMatchObject({ skin: 2 });
    expect(issues.join('\n')).toMatch(/entities\.1: position/);
    expect(issues.join('\n')).toMatch(/c\.skin/);
  });

  it('restores -0 as 0, so a saved scene equals its restored copy', () => {
    const doc = parseScene({ version: 3, entities: [{ type: 'group', id: 'a', ...base, rotation: [-0, 0, -0] }] })!;
    expect(Object.is(doc.entities[0].rotation[0], 0)).toBe(true);
  });
});
