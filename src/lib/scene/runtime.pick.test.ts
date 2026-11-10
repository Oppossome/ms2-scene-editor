import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Vector2 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneRuntime } from './runtime.svelte.js';
import { entity } from './testing.js';

const mocks = vi.hoisted(() => ({ instantiate: vi.fn() }));
vi.mock('../assets/loader.js', () => ({ ...mocks, loadClips: vi.fn() }));

let runtime: SceneRuntime;
let geometry: BoxGeometry;
let material: MeshBasicMaterial;
let camera: OrthographicCamera;
beforeEach(() => {
  geometry = new BoxGeometry(2, 2, 2);
  material = new MeshBasicMaterial();
  mocks.instantiate.mockReset().mockImplementation(async () => ({
    object: new Group().add(new Mesh(geometry, material)),
    animations: []
  }));
  runtime = new SceneRuntime();
  camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 20;
  camera.updateMatrixWorld(true);
});
afterEach(() => {
  runtime.dispose();
  geometry.dispose();
  material.dispose();
});

async function setup() {
  const nodes = [entity('root', 'group'), entity('group', 'group', 'root'), entity('prop', 'prop', 'group')];
  runtime.sync(nodes);
  await vi.waitFor(() => expect(runtime.objectOf('prop')?.children).toHaveLength(1));
  runtime.root.updateMatrixWorld(true);
  return nodes;
}

describe('viewport picking', () => {
  it('picks an unlocked prop or its root ancestor', async () => {
    await setup();
    expect(runtime.pick(new Vector2(), camera)).toBe('prop');
    expect(runtime.pick(new Vector2(), camera, true)).toBe('root');
  });

  it.each(['root', 'group', 'prop'])('requires the lock override when %s is locked', async (id) => {
    const nodes = await setup();
    nodes.find((node) => node.id === id)!.set({ locked: true });
    runtime.sync(nodes);
    expect(runtime.pick(new Vector2(), camera)).toBeNull();
    expect(runtime.pick(new Vector2(), camera, true)).toBeNull();
    expect(runtime.pick(new Vector2(), camera, false, true)).toBe('prop');
    expect(runtime.pick(new Vector2(), camera, true, true)).toBe('root');

    nodes.find((node) => node.id === id)!.set({ locked: false });
    runtime.sync(nodes);
    expect(runtime.pick(new Vector2(), camera)).toBe('prop');
  });

  it('does not let a locked sibling or descendant block an unlocked prop', async () => {
    const nodes = await setup();
    nodes.push(entity('locked sibling', 'group', 'group', { locked: true }));
    nodes.push(entity('locked child', 'group', 'prop', { locked: true }));
    runtime.sync(nodes);
    expect(runtime.pick(new Vector2(), camera)).toBe('prop');
  });

  it.each(['root', 'group', 'prop'])('never overrides visibility when %s is hidden', async (id) => {
    const nodes = await setup();
    nodes.find((node) => node.id === id)!.set({ visible: false, locked: true });
    runtime.sync(nodes);
    expect(runtime.pick(new Vector2(), camera, false, true)).toBeNull();
  });

  it('picks through a locked hierarchy to an unlocked prop behind it', async () => {
    const nodes = await setup();
    nodes[0].set({ locked: true });
    nodes.push(entity('behind', 'prop', null, { position: [0, 0, -5] }));
    runtime.sync(nodes);
    await vi.waitFor(() => expect(runtime.objectOf('behind')?.children).toHaveLength(1));
    runtime.root.updateMatrixWorld(true);
    expect(runtime.pick(new Vector2(), camera)).toBe('behind');
    expect(runtime.pick(new Vector2(), camera, false, true)).toBe('prop');
  });
});
