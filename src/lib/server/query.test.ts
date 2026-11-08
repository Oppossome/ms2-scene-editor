import { describe, expect, it } from 'vitest';
import { itemFitsGender, searchByName, searchItems } from './query';
import type { ItemRecord } from '../types';

const item = (over: Partial<ItemRecord>): ItemRecord => ({
  id: '1',
  name: 'Item',
  cls: 'coat',
  icon: '',
  slots: ['CL'],
  assets: [{ slot: 'CL', glb: 'a.glb', gender: 2, selfnode: '', targetnode: '', attachnode: '', replace: true, earfold: false, weapon: false }],
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
    assets: [{ slot: 'CL', glb: 'f.glb', gender: 1, selfnode: '', targetnode: '', attachnode: '', replace: true, earfold: false, weapon: false }]
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
