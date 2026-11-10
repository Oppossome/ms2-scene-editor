import { describe, expect, it, vi } from 'vitest';
import { BaseEntity, GroupEntity, LightingEntity, restoreEntity } from './entity.svelte.js';
import { SceneState } from './store.svelte.js';
import { SceneRuntime } from './runtime.svelte.js';
import { entity } from './testing.js';

const loaded = (...entities: BaseEntity[]) => {
  const store = new SceneState();
  store.load(entities as never[], false);
  return store;
};

describe('entity state', () => {
  it('gives each entity its own immutable values', () => {
    const source = { type: 'group', id: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const first = restoreEntity(source);
    const second = restoreEntity(source);
    (source.position as number[])[0] = 90;
    expect(first.position).toEqual([0, 0, 0]);
    expect(() => { (first.position as number[])[0] = 50; }).toThrow();
    const saved = first.toJSON();
    expect(saved.position).toEqual([0, 0, 0]);
    expect(second.position).toEqual([0, 0, 0]);
  });

  it('validates a whole edit before accepting any of it', () => {
    const group = entity('a', 'group');
    expect(() => group.prepare({ name: 'Changed', position: [0, Infinity, 0] })).toThrow(/position/);
    expect(group.name).toBe('a');
    expect(() => group.prepare({ nope: 1 })).toThrow(/no editable property nope/);
    expect(group.prepare({ name: 'a' }).size).toBe(0);
  });

  it('bumps its revision only when a value changes', () => {
    const group = entity('a', 'group');
    const revision = group.revision;
    group.set({ name: 'a' });
    expect(group.revision).toBe(revision);
    group.set({ name: 'b', position: [1, 2, 3] });
    expect(group.revision).toBe(revision + 1);
    expect(group).toBeInstanceOf(GroupEntity);
  });
});

describe('scene transactions', () => {
  it('keeps entity instances through edits and reparenting, and restores real classes on undo and redo', () => {
    const store = new SceneState();
    const group = store.add({ type: 'group', name: 'Parent' });
    const id = store.add({ type: 'group', name: 'Child' });
    const original = store.node(id)!;
    store.update(id, { position: [2, 3, 4] });
    expect(store.node(id)).toBe(original);
    store.reparent(id, group);
    expect(store.node(id)).toBe(original);
    store.undo();
    expect(store.node(id)).toBeInstanceOf(GroupEntity);
    expect(store.node(id)?.parentId).toBeNull();
    expect(store.node(id)).not.toBe(original);
    store.redo();
    expect(store.node(id)?.parentId).toBe(group);
    store.update(id, { name: 'After redo' });
    store.undo();
    expect(store.node(id)?.name).toBe('Child');
    store.redo();
    expect(store.node(id)?.name).toBe('After redo');
  });

  it('records a gesture only when it changes something, as one step', () => {
    const store = loaded(entity('a', 'group'));
    store.beginGesture();
    store.update('a', { position: [0, 0, 0] }, false);
    store.endGesture();
    expect(store.canUndo).toBe(false);
    store.beginGesture();
    store.update('a', { position: [1, 0, 0] }, false);
    store.update('a', { position: [2, 0, 0] }, false);
    store.endGesture();
    store.undo();
    expect(store.node('a')?.position).toEqual([0, 0, 0]);
    expect(store.canUndo).toBe(false);
    store.redo();
    expect(store.node('a')?.position).toEqual([2, 0, 0]);
  });

  it('rejects an invalid edit as a whole, with a message', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = loaded(entity('a', 'group'));
      const revision = store.revision;
      store.update('a', { name: 'Changed', position: [0, Infinity, 0] });
      expect(store.error).toContain('Cannot edit');
      expect(store.node('a')?.name).toBe('a');
      expect(store.revision).toBe(revision);
      expect(store.canUndo).toBe(false);
      store.update('a', { parentId: 'a' });
      expect(store.node('a')?.parentId).toBeNull();
      store.update('a', { type: 'prop' });
      expect(store.node('a')?.type).toBe('group');
    } finally {
      warning.mockRestore();
    }
  });

  it('suppresses net-no-op transactions, groups structural actions, and rolls back failures', () => {
    const store = loaded(entity('a', 'group'));
    store.transaction(() => {
      store.update('a', { name: 'Temporary' });
      store.update('a', { name: 'a' });
    });
    expect(store.canUndo).toBe(false);
    store.transaction(() => {
      store.add({ type: 'group', name: 'First' });
      store.add({ type: 'group', name: 'Second' });
    });
    store.undo();
    expect(store.nodes).toHaveLength(1);
    expect(store.canUndo).toBe(false);
    expect(() => store.transaction(() => {
      store.update('a', { name: 'Temporary' });
      throw new Error('Failure');
    })).toThrow('Failure');
    expect(store.node('a')?.name).toBe('a');
    expect(store.canUndo).toBe(false);
  });

  it('duplicates through JSON with independent properties, and history keeps the copies stable', () => {
    const store = new SceneState();
    const group = store.add({ type: 'group', name: 'Map', mapId: '1' });
    store.add({ type: 'lighting', name: 'Lighting', parentId: group, environment: { background: 'sky.png' } });
    const copy = store.duplicate(group)!;
    const saved = store.serialize();
    store.undo();
    store.redo();
    expect(store.serialize()).toBe(saved);
    store.update(copy, { position: [100, 0, 0] });
    expect(store.node(group)?.position).toEqual([0, 0, 0]);
    expect(store.nodes.find((node) => node.parentId === copy)).toBeInstanceOf(LightingEntity);
    expect(store.nodes.filter((node) => node.type === 'lighting')[1]).not.toBe(store.nodes.filter((node) => node.type === 'lighting')[0]);
  });

  it('tells the renderer what to render again', () => {
    const store = new SceneState();
    const group = store.add({ type: 'group', name: 'G' });
    store.changedIds.clear();
    const child = store.add({ type: 'group', name: 'C', parentId: group });
    expect([...store.changedIds]).toEqual([child]);
    store.changedIds.clear();
    store.update(child, { name: 'D' });
    expect([...store.changedIds].sort()).toEqual([child, group].sort());
  });
});

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
