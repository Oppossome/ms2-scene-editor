import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities/types.js';
import { SceneState } from './store.svelte.js';
import { SceneRuntime } from './runtime.svelte.js';
import { entity } from './testing.js';

const loaded = (...entities: Entity[]) => {
  const store = new SceneState();
  store.load(entities, false);
  return store;
};

describe('Lighting resolution', () => {
  const lighting = (id: string, parentId: string | null, environment: object, visible = true) =>
    entity(id, 'lighting', parentId, { environment, visible });

  it('uses the first effectively visible Lighting in depth-first order, including an empty one', () => {
    const store = loaded(
      entity('group', 'group', null, { visible: false }),
      lighting('hidden', 'group', { background: 'hidden.png' }),
      lighting('later', null, { background: 'later.png' }),
      lighting('empty', 'group', {})
    );
    const runtime = new SceneRuntime();
    try {
      runtime.sync(store.nodes);
      expect(runtime.mapEnvironment()?.background).toBe('later.png');
      store.update('group', { visible: true });
      runtime.sync(store.nodes);
      expect(runtime.mapEnvironment()?.background).toBe('hidden.png');
      store.update('hidden', { visible: false });
      runtime.sync(store.nodes);
      expect(runtime.mapEnvironment()).toEqual({});
      expect(runtime.objectOf('empty')).toBeUndefined();
      expect(runtime.boundsOf('empty')).toBeNull();
      store.reparent('later', null, { beforeId: 'group' });
      runtime.sync(store.nodes);
      expect(runtime.mapEnvironment()?.background).toBe('later.png');
    } finally {
      runtime.dispose();
    }
  });

  it('does not dirty history or autosave on playback ticks', () => {
    const store = loaded(entity('a', 'group'));
    const runtime = new SceneRuntime();
    try {
      runtime.sync(store.nodes);
      const revision = store.revision;
      for (let frame = 0; frame < 60; frame++) runtime.update(1 / 30);
      expect(store.revision).toBe(revision);
      expect(store.canUndo).toBe(false);
    } finally {
      runtime.dispose();
    }
  });
});
