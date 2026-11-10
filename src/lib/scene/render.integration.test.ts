import { Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PropEntity } from '../entities/prop.svelte.js';
import { SceneRuntime } from './runtime.svelte.js';
import { SceneState } from './store.svelte.js';

const mocks = vi.hoisted(() => ({ instantiate: vi.fn(), loadClips: vi.fn(), loadModel: vi.fn() }));
vi.mock('../assets/loader.js', () => mocks);
let runtime: SceneRuntime;
let store: SceneState;
beforeEach(() => {
  mocks.instantiate.mockReset();
  mocks.loadClips.mockReset();
  runtime = new SceneRuntime();
  store = new SceneState();
});
afterEach(() => runtime.dispose());

const render = () => {
  runtime.sync(store.nodes, store.changedIds);
  store.changedIds.clear();
};

describe('scene rendering integration', () => {
  it('renders only what changed', () => {
    mocks.instantiate.mockResolvedValue({ object: new Group(), animations: [] });
    const a = store.add({ type: 'prop', name: 'A', glb: 'a.glb' });
    const b = store.add({ type: 'prop', name: 'B', glb: 'b.glb' });
    render();
    const spy = vi.spyOn(store.node(b) as PropEntity, 'render');
    const other = vi.spyOn(store.node(a) as PropEntity, 'render');
    store.update(a, { name: 'Renamed' });
    render();
    expect(other).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    render();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('discards stale loads after the source changes or the entity is deleted', async () => {
    let first!: (value: { object: Group; animations: [] }) => void;
    let second!: (value: { object: Group; animations: [] }) => void;
    mocks.instantiate
      .mockReturnValueOnce(new Promise((resolve) => { first = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { second = resolve; }));
    const id = store.add({ type: 'prop', name: 'Pending', glb: 'Map/first.glb' });
    render();
    const entity = store.node(id)!;
    store.update(id, { glb: 'Map/second.glb' });
    render();
    const stale = new Group();
    first({ object: stale, animations: [] });
    await Promise.resolve();
    expect(stale.parent).toBeNull();
    store.remove(id);
    render();
    const late = new Group();
    second({ object: late, animations: [] });
    await Promise.resolve();
    expect(late.parent).toBeNull();
    expect(entity.disposed).toBe(true);
    expect(runtime.objectOf(id)).toBeUndefined();
  });

  it('renders restored entities with matching ids from their own state', async () => {
    mocks.instantiate.mockImplementation(async () => ({ object: new Group(), animations: [] }));
    const id = store.add({ type: 'prop', name: 'Prop', glb: 'Map/a.glb' });
    render();
    await vi.waitFor(() => expect(runtime.objectOf(id)?.children.length).toBe(1));
    const original = store.node(id)!;
    store.update(id, { position: [3, 0, 0] });
    store.undo();
    render();
    expect(original.disposed).toBe(true);
    expect(original.object?.parent).toBeNull();
    expect(store.node(id)).not.toBe(original);
    expect(runtime.objectOf(id)?.position.x).toBe(0);
    store.redo();
    render();
    expect(runtime.objectOf(id)?.position.x).toBe(3);
  });

  it('reports a load failure instead of presenting a successful placeholder', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.instantiate.mockRejectedValue(new Error('missing model'));
      const report = vi.fn();
      runtime.hooks.error = report;
      store.add({ type: 'prop', name: 'Missing', glb: 'Map/missing.glb' });
      render();
      await vi.waitFor(() => expect(report).toHaveBeenCalledWith('Failed to load Missing: missing model'));
    } finally {
      error.mockRestore();
    }
  });
});
