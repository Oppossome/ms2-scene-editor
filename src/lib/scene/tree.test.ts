import { describe, expect, it } from 'vitest';
import { entity as n } from './testing';
import {
  ancestorsOf,
  canParent,
  cloneSubtree,
  deleteSubtree,
  descendantsOf,
  flatten,
  pathOf,
  rootOf,
  uniqueName
} from './tree';

// g > (hero > (hat, top), crate), loose
const nodes = [n('g', 'group'), n('hero', 'character', 'g'), n('hat', 'item', 'hero'), n('top', 'item', 'hero'), n('crate', 'prop', 'g'), n('loose', 'prop')];

describe('queries', () => {
  it('finds descendants, ancestors, root and path', () => {
    expect(descendantsOf(nodes, 'g').map((x) => x.id).sort()).toEqual(['crate', 'hat', 'hero', 'top']);
    expect(ancestorsOf(nodes, 'hat').map((x) => x.id)).toEqual(['hero', 'g']);
    expect(rootOf(nodes, 'hat')?.id).toBe('g');
    expect(rootOf(nodes, 'loose')?.id).toBe('loose');
    expect(pathOf(nodes, 'hat')).toEqual(['g', 'hero', 'hat']);
  });

  it('flattens depth first, honouring collapsed nodes', () => {
    expect(flatten(nodes).map((r) => [r.node.id, r.depth])).toEqual([
      ['g', 0],
      ['hero', 1],
      ['hat', 2],
      ['top', 2],
      ['crate', 1],
      ['loose', 0]
    ]);
    expect(flatten(nodes, (id) => id !== 'hero').map((r) => r.node.id)).toEqual(['g', 'hero', 'crate', 'loose']);
  });
});

describe('canParent', () => {
  it('blocks cycles and self-parenting', () => {
    expect(canParent(nodes, 'g', 'hero')).toBe(false);
    expect(canParent(nodes, 'g', 'g')).toBe(false);
    expect(canParent(nodes, 'crate', 'loose')).toBe(true);
  });

  it('only lets items live on characters and nothing live on items', () => {
    expect(canParent(nodes, 'hat', 'loose')).toBe(false);
    expect(canParent(nodes, 'hat', null)).toBe(false);
    expect(canParent(nodes, 'hat', 'hero')).toBe(true);
    expect(canParent(nodes, 'crate', 'hat')).toBe(false);
  });

  it('rejects unknown nodes', () => {
    expect(canParent(nodes, 'nope', null)).toBe(false);
    expect(canParent(nodes, 'crate', 'nope')).toBe(false);
  });
});

describe('deleteSubtree / cloneSubtree', () => {
  it('deletes a node with its descendants', () => {
    expect(deleteSubtree(nodes, 'hero').map((x) => x.id)).toEqual(['g', 'crate', 'loose']);
  });

  it('clones with fresh ids and remapped parents, copy first', () => {
    const copies = cloneSubtree(nodes, 'hero');
    expect(copies).toHaveLength(3);
    expect(copies[0]).toMatchObject({ type: 'character', parentId: 'g' });
    expect(copies.every((c) => !nodes.some((x) => x.id === c.id))).toBe(true);
    expect(copies.slice(1).map((c) => c.parentId)).toEqual([copies[0].id, copies[0].id]);
    expect(copies.slice(1).map((c) => c.name)).toEqual(['hat', 'top']);
  });

  it('returns nothing for an unknown id', () => {
    expect(cloneSubtree(nodes, 'nope')).toEqual([]);
  });
});

describe('uniqueName', () => {
  it('numbers clashing sibling names', () => {
    expect(uniqueName(nodes, 'g', 'Crate')).toBe('Crate');
    expect(uniqueName(nodes, 'g', 'crate')).toBe('crate 2');
    const more = [...nodes, n('c2', 'prop', 'g', { name: 'crate 2' })];
    expect(uniqueName(more, 'g', 'crate')).toBe('crate 3');
  });
});
