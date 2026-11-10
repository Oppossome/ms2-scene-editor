import { describe, expect, it } from 'vitest';
import { groupNpcs, itemFitsGender, searchByName, searchItems, searchNpcs } from './query';
import type { NpcRecord } from '../types';
import type { ItemRecord } from '../types';

const item = (over: Partial<ItemRecord>): ItemRecord => ({
  id: '1',
  name: 'Item',
  cls: 'coat',
  icon: '',
  slots: ['CL'],
  assets: [
    {
      slot: 'CL',
      glb: 'a.glb',
      gender: 2,
      selfnode: '',
      targetnode: '',
      attachnode: '',
      replace: true,
      earfold: false,
      weapon: false
    }
  ],
  palette: 0,
  defaultColor: 0,
  channels: [false, false],
  type: 1,
  subtype: 0,
  category: '',
  ...over
});

const items = [
  item({ id: '3', name: 'Red Hat', cls: 'hat', slots: ['CP'] }),
  item({ id: '1', name: 'Blue Coat' }),
  item({
    id: '2',
    name: 'Female Dress',
    cls: 'dress',
    assets: [
      {
        slot: 'CL',
        glb: 'f.glb',
        gender: 1,
        selfnode: '',
        targetnode: '',
        attachnode: '',
        replace: true,
        earfold: false,
        weapon: false
      }
    ]
  })
];

describe('searchItems', () => {
  it('filters by text, slot and class (case-insensitive) and sorts by name', () => {
    expect(searchItems(items, { q: 'red' }).items.map((i) => i.id)).toEqual(['3']);
    expect(searchItems(items, { slot: 'cl' }).items.map((i) => i.id)).toEqual(['1', '2']);
    expect(searchItems(items, { cls: 'HAT' }).items.map((i) => i.id)).toEqual(['3']);
  });

  it('matches by id and requires every word', () => {
    expect(searchItems(items, { q: '2' }).items.map((i) => i.id)).toEqual(['2']);
    expect(searchItems(items, { q: 'blue hat' }).total).toBe(0);
  });

  it('filters by gender, treating 2 as both', () => {
    expect(searchItems(items, { gender: 0 }).items.map((i) => i.id)).toEqual(['1', '3']);
    expect(searchItems(items, { gender: 1 }).total).toBe(3);
    expect(itemFitsGender(items[2], 0)).toBe(false);
  });

  it('paginates with a capped limit', () => {
    const page = searchItems(items, { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });
});

describe('searchByName', () => {
  it('matches name and id words', () => {
    const records = [
      { id: '10', name: 'Henesys' },
      { id: '20', name: 'Tria' }
    ];
    expect(searchByName(records, 'hen').items).toEqual([records[0]]);
    expect(searchByName(records, '20').items).toEqual([records[1]]);
    expect(searchByName(records, '').total).toBe(2);
  });
});

const npc = (id: string, name: string, glb: string, level: number, scale = 1): NpcRecord => ({
  id,
  name,
  glb,
  level,
  scale
});

describe('groupNpcs', () => {
  const npcs = [
    npc('3', 'Shade', 'shade.glb', 50, 1.15),
    npc('1', 'Shade', 'shade.glb', 10, 0.9),
    npc('2', 'Shade', 'shade.glb', 30),
    npc('4', 'Cathy', 'trader2.glb', 10),
    npc('5', 'Cathy', 'trader3.glb', 10),
    npc('6', 'Hen', 'hen.glb', 1)
  ];

  it('shows NPCs of one name and model once, whatever their level', () => {
    const groups = groupNpcs(npcs).map((g) => g.entry);
    expect(groups).toHaveLength(4);
    const shade = groups.find((g) => g.name === 'Shade')!;
    expect(shade).toMatchObject({ id: '1', level: 10, scale: 0.9, variants: 3, levels: [10, 50] });
  });

  it('keeps the same name apart when the models differ', () => {
    expect(
      groupNpcs(npcs)
        .filter((g) => g.entry.name === 'Cathy')
        .map((g) => g.entry.glb)
    ).toEqual(['trader2.glb', 'trader3.glb']);
  });

  it('picks the entry the same way whatever the order, and lists every id', () => {
    const a = groupNpcs(npcs).find((g) => g.entry.name === 'Shade')!;
    const b = groupNpcs([...npcs].reverse()).find((g) => g.entry.name === 'Shade')!;
    expect(b.entry).toEqual(a.entry);
    expect(a.ids).toEqual(['1', '2', '3']);
  });

  it('gives a lone NPC one variant at its own level', () => {
    expect(groupNpcs([npc('6', 'Hen', 'hen.glb', 1)])[0].entry).toMatchObject({ variants: 1, levels: [1, 1] });
    expect(groupNpcs([])).toEqual([]);
  });

  it('does not mix up names and models that join into the same text', () => {
    const groups = groupNpcs([npc('1', 'a', 'b.glb', 1), npc('2', 'a b', '.glb', 1)]);
    expect(groups).toHaveLength(2);
  });
});

describe('searchNpcs', () => {
  const groups = groupNpcs([
    npc('11', 'Shade', 'shade.glb', 10),
    npc('12', 'Shade', 'shade.glb', 30),
    npc('21', 'Hen', 'hen.glb', 1)
  ]);

  it('finds a group by name, or by the id of any NPC in it', () => {
    expect(searchNpcs(groups, 'shade').items.map((i) => i.id)).toEqual(['11']);
    expect(searchNpcs(groups, '12').items.map((i) => i.id)).toEqual(['11']);
    expect(searchNpcs(groups, 'shade 12').total).toBe(1);
    expect(searchNpcs(groups, 'nothing').total).toBe(0);
  });

  it('lists everything by name, in pages', () => {
    expect(searchNpcs(groups, '').items.map((i) => i.name)).toEqual(['Hen', 'Shade']);
    const page = searchNpcs(groups, '', 1, 1);
    expect(page).toMatchObject({ total: 2, offset: 1 });
    expect(page.items.map((i) => i.name)).toEqual(['Shade']);
  });

  it('does not hand out the ids it matched on', () => {
    expect(searchNpcs(groups, '').items[0]).not.toHaveProperty('ids');
  });
});
