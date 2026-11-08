import { describe, expect, it } from 'vitest';
import { previewUrlForModel } from '../assets/urls';
import type { SceneNode } from './model';
import { defaultInsertParent, itemTargetCharacter } from './insert';

const n = (id: string, kind: SceneNode['kind'], parentId: string | null = null): SceneNode => ({
  id,
  kind,
  name: id,
  parentId,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
  locked: false
});

const nodes = [n('g', 'group'), n('hero', 'character', 'g'), n('hat', 'item', 'hero'), n('crate', 'prop'), n('map', 'map')];

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

  it('is null for anything else', () => {
    expect(itemTargetCharacter(nodes, 'g')).toBeNull();
    expect(itemTargetCharacter(nodes, 'crate')).toBeNull();
    expect(itemTargetCharacter(nodes, null)).toBeNull();
  });
});

describe('previewUrlForModel', () => {
  it('maps a converted model to its extracted NIF preview', () => {
    expect(previewUrlForModel('Map/common/field/a b.glb')).toBe('/api/assets/converted/model-previews/Map/common/field/a%20b.png');
    expect(previewUrlForModel('Npc/11/11000038/11000038_normaldoctor.GLB')).toBe(
      '/api/assets/converted/model-previews/Npc/11/11000038/11000038_normaldoctor.png'
    );
  });

  it('is empty without a model', () => {
    expect(previewUrlForModel('')).toBe('');
  });
});
