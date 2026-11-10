import { describe, expect, it } from 'vitest';
import { entity as n } from '../../scene/testing';
import { defaultInsertParent, itemTargetCharacter } from './insert';

const nodes = [n('g', 'group'), n('hero', 'character', 'g'), n('hat', 'item', 'hero'), n('crate', 'prop'), n('map', 'group', null, { mapId: '1' })];

describe('defaultInsertParent', () => {
  it('uses the selected node when it can hold children', () => {
    expect(defaultInsertParent(nodes, 'g')).toBe('g');
    expect(defaultInsertParent(nodes, 'hero')).toBe('hero');
    expect(defaultInsertParent(nodes, 'crate')).toBe('crate');
    expect(defaultInsertParent(nodes, 'map')).toBe('map');
  });

  it('falls back to the scene root for items, nothing and unknown ids', () => {
    expect(defaultInsertParent(nodes, 'hat')).toBeNull();
    expect(defaultInsertParent(nodes, null)).toBeNull();
    expect(defaultInsertParent(nodes, 'gone')).toBeNull();
  });
});

describe('itemTargetCharacter', () => {
  it('is the selected character or the owner of the selected item', () => {
    expect(itemTargetCharacter(nodes, 'hero')?.id).toBe('hero');
    expect(itemTargetCharacter(nodes, 'hat')?.id).toBe('hero');
  });

  it('walks up the tree to the nearest character', () => {
    const deep = [...nodes, n('mount', 'prop', 'hero'), n('sub', 'group', 'mount'), n('deeper', 'item', 'sub')];
    expect(itemTargetCharacter(deep, 'mount')?.id).toBe('hero');
    expect(itemTargetCharacter(deep, 'deeper')?.id).toBe('hero');
  });

  it('is null for anything else', () => {
    expect(itemTargetCharacter(nodes, 'g')).toBeNull();
    expect(itemTargetCharacter(nodes, 'crate')).toBeNull();
    expect(itemTargetCharacter(nodes, null)).toBeNull();
  });
});
