import { describe, expect, it, vi } from 'vitest';
import type { ItemRecord } from '../../types';

const record = (id: string, slots: string[]): ItemRecord => ({
  id,
  name: `item ${id}`,
  cls: '',
  icon: '',
  slots,
  assets: [],
  palette: 0,
  defaultColor: 0,
  channels: [false, false],
  type: 0,
  subtype: 0,
  category: ''
});

const records: Record<string, ItemRecord> = { '11': record('11', ['RH']), '12': record('12', ['CP']) };
vi.mock('../../entities/character/build.js', () => ({ getItem: vi.fn(async (id: string) => records[id] ?? null) }));

const { previewEntities, sceneEntities } = await import('./entities');
const { restoreEntity } = await import('../../entities/registry');
const { entity } = await import('../../scene/testing');

describe('sceneEntities', () => {
  it('copies a node and its items, placed at the origin without its animation state', () => {
    const character = entity('c', 'character', 'group', {
      position: [5, 0, 0],
      rotation: [0, 1, 0],
      clip: 'idle_a',
      freeze: 3,
      speed: 2,
      visible: false,
      attachBone: 'Bip01'
    });
    const sword = entity('s', 'item', 'c', { itemId: '11', slots: ['RH'], hold: 'hand' });
    const [root, item] = sceneEntities(character, [sword]);
    expect(root).toMatchObject({ type: 'character', id: 'c', parentId: null, visible: true, speed: 2 });
    expect(root).toMatchObject({ position: [0, 0, 0], rotation: [0, 0, 0] });
    expect(root).not.toHaveProperty('clip');
    expect(root).not.toHaveProperty('freeze');
    expect(root).not.toHaveProperty('attachBone');
    expect(item).toMatchObject({ type: 'item', parentId: 'c', itemId: '11', hold: 'hand' });
    expect(() => restoreEntity(root)).not.toThrow();
  });
});

describe('previewEntities', () => {
  it('dresses an outfit with entity items, skipping unknown ones', async () => {
    const list = await previewEntities({
      kind: 'character',
      gender: 0,
      skin: 2,
      items: [{ id: '11', hold: 'carry' }, { id: '99' }],
      clip: 'sword_attack_01_a'
    });
    expect(list.map((e) => e.type)).toEqual(['character', 'item']);
    expect(list[0]).toMatchObject({ gender: 0, skin: 2, clip: 'sword_attack_01_a' });
    expect(list[1]).toMatchObject({ parentId: list[0].id, itemId: '11', slots: ['RH'], hold: 'carry' });
    for (const input of list) expect(() => restoreEntity(input)).not.toThrow();
  });

  it('tries an item on a scene character, replacing what shares its slot', async () => {
    const character = entity('c', 'character', null, { clip: 'idle_a' });
    const worn = [
      entity('a', 'item', 'c', { itemId: '11', slots: ['RH'] }),
      entity('b', 'item', 'c', { itemId: '12', slots: ['CP'] })
    ];
    const list = await previewEntities({
      kind: 'item',
      item: record('13', ['RH']),
      gender: 1,
      color: 2,
      base: sceneEntities(character, worn)
    });
    expect(list.map((e) => e.id)).toEqual(['c', 'b', 'preview-item-2']);
    expect(list[2]).toMatchObject({ parentId: 'c', itemId: '13', color: 2 });
  });

  it('layers a tried-on item over its slot when it should not replace', async () => {
    const character = entity('c', 'character');
    const worn = [entity('a', 'item', 'c', { itemId: '11', slots: ['RH'] })];
    const base = sceneEntities(character, worn);
    const layered = await previewEntities({
      kind: 'item',
      item: record('13', ['RH']),
      gender: 1,
      base,
      replace: false
    });
    expect(layered.map((e) => e.id)).toEqual(['c', 'a', 'preview-item-1']);
    const same = await previewEntities({ kind: 'item', item: record('11', ['RH']), gender: 1, base, replace: false });
    expect(same.map((e) => e.id)).toEqual(['c', 'preview-item-1']);
  });

  it('plays the asked clip on a scene copy and shows models at their scale', async () => {
    const npc = entity('n', 'npc', null, { glb: 'a.glb', clip: 'walk' });
    const [copy] = await previewEntities({ kind: 'entities', entities: sceneEntities(npc), clip: 'run' });
    expect(copy).toMatchObject({ id: 'n', glb: 'a.glb', clip: 'run' });
    const [model] = await previewEntities({ kind: 'model', glb: 'b.glb', scale: 2 });
    expect(model).toMatchObject({ type: 'npc', glb: 'b.glb', scale: [2, 2, 2] });
    expect(model).not.toHaveProperty('clip');
  });
});
