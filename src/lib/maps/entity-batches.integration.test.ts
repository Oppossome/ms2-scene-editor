import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  SkinnedMesh,
  Vector2
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneRuntime } from '../scene/runtime.svelte.js';
import { SceneState } from '../scene/store.svelte.js';
import { entity } from '../scene/testing.js';

const mocks = vi.hoisted(() => ({ loadModel: vi.fn(), instantiate: vi.fn(), exportGlb: vi.fn() }));
vi.mock('../assets/loader.js', () => ({ ...mocks, loadClips: vi.fn() }));
vi.mock('../export/glb.js', () => ({ exportGlb: mocks.exportGlb }));

let geometry: BoxGeometry;
let material: MeshBasicMaterial;
let runtime: SceneRuntime;
let store: SceneState;
beforeEach(() => {
  geometry = new BoxGeometry(2, 2, 2);
  material = new MeshBasicMaterial();
  const scene = new Group();
  const part = new Mesh(geometry, material);
  part.position.x = 2;
  scene.add(part);
  mocks.loadModel.mockReset().mockResolvedValue({ scene, animations: [] });
  mocks.instantiate.mockReset().mockImplementation(async () => ({ object: scene.clone(true), animations: [] }));
  mocks.exportGlb.mockReset().mockResolvedValue(new ArrayBuffer(8));
  runtime = new SceneRuntime();
  store = new SceneState();
  store.hooks.localFor = (id, parentId, bone) => runtime.localFor(id, parentId, bone);
});
afterEach(() => {
  runtime.dispose();
  geometry.dispose();
  material.dispose();
});

const world = (id: string) => {
  const object = runtime.objectOf(id)!;
  object.updateWorldMatrix(true, false);
  return object.matrixWorld.clone();
};
const meshes = () => runtime.root.children.filter((object): object is InstancedMesh => object instanceof InstancedMesh);
async function insert(count = 2) {
  const map = entity('map', 'group', null, { mapId: '1' });
  const props = Array.from({ length: count }, (_, i) =>
    entity(`prop${i}`, 'prop', 'map', { glb: 'Map/a.glb', instanced: true, position: [i * 20, 0, 0] })
  );
  store.append([map, ...props]);
  const ids = [map.id, ...props.map((prop) => prop.id)];
  runtime.sync(store.nodes);
  await vi.waitFor(() => expect(meshes()[0]?.count).toBe(count));
  return ids;
}

describe('editable instance batches', () => {
  it('maps raycast slots to individual entities, respects locks, and bounds only the selected placement', async () => {
    const ids = await insert();
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    camera.position.set(2, 0, 20);
    camera.lookAt(2, 0, 0);
    camera.updateMatrixWorld(true);
    expect(runtime.pick(new Vector2(), camera)).toBe(ids[1]);
    expect(runtime.pick(new Vector2(), camera, true)).toBe(ids[0]);
    expect(runtime.boundsOf(ids[1])?.min.x).toBeCloseTo(1);
    expect(runtime.boundsOf(ids[1])?.max.x).toBeCloseTo(3);
    expect(runtime.boundsOf(ids[2])?.min.x).toBeCloseTo(21);
    store.update(ids[1], { locked: true });
    runtime.sync(store.nodes);
    expect(runtime.pick(new Vector2(), camera)).toBeNull();
    expect(runtime.pick(new Vector2(), camera, false, true)).toBe(ids[1]);
    store.update(ids[1], { locked: false });
    store.update(ids[0], { locked: true });
    runtime.sync(store.nodes);
    expect(runtime.pick(new Vector2(), camera)).toBeNull();
    expect(runtime.pick(new Vector2(), camera, true)).toBeNull();
    expect(runtime.pick(new Vector2(), camera, false, true)).toBe(ids[1]);
    expect(runtime.pick(new Vector2(), camera, true, true)).toBe(ids[0]);
    store.update(ids[1], { visible: false });
    runtime.sync(store.nodes);
    expect(meshes()[0].count).toBe(1);
    expect(runtime.boundsOf(ids[1])).toBeNull();
    expect(runtime.pick(new Vector2(), camera, false, true)).toBeNull();
    store.update(ids[0], { visible: false });
    runtime.sync(store.nodes);
    expect(meshes()[0].count).toBe(0);
  });
  it('updates individual transforms, parents, deletion, centering and undo without reloading cached models', async () => {
    const ids = await insert();
    const first = store.node(ids[1]);
    store.update(ids[0], { position: [5, 3, 0], rotation: [0, 0, Math.PI / 2], scale: [2, 2, 2] });
    runtime.sync(store.nodes);
    const before = world(ids[1]);
    const positions = runtime.groupCenterPositions(ids[0])!;
    store.updatePositions(positions);
    runtime.sync(store.nodes);
    world(ids[1]).elements.forEach((value, i) => expect(value).toBeCloseTo(before.elements[i]));
    store.reparent(ids[1], null);
    runtime.sync(store.nodes);
    expect(store.node(ids[1])).toBe(first);
    world(ids[1]).elements.forEach((value, i) => expect(value).toBeCloseTo(before.elements[i]));
    store.update(ids[1], { position: [100, 0, 0] });
    runtime.sync(store.nodes);
    const matrix = new Matrix4();
    meshes()[0].getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(100);
    store.remove(ids[2]);
    runtime.sync(store.nodes);
    expect(meshes()[0].count).toBe(1);
    store.undo();
    runtime.sync(store.nodes);
    expect(meshes()[0].count).toBe(2);
    expect(mocks.loadModel).toHaveBeenCalledTimes(1);
    expect(mocks.instantiate).not.toHaveBeenCalled();
  });
  it('exports selected props with geometry while keeping imported map groups omitted', async () => {
    const ids = await insert();
    expect(await runtime.exportGlb(ids[0], false)).toBeNull();
    await runtime.exportGlb(ids[1], false);
    expect(mocks.instantiate).toHaveBeenCalledTimes(1);
    expect(mocks.exportGlb).toHaveBeenCalledTimes(1);
    expect(runtime.objectOf(ids[1])?.children).toHaveLength(0);
  });
  it('cancels late model attachment after deletion', async () => {
    const scene = new Group();
    scene.add(new Mesh(geometry, material));
    let resolve!: (value: { scene: Group; animations: [] }) => void;
    mocks.loadModel.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const id = store.add({ type: 'prop', name: 'Pending', glb: 'Map/a.glb', instanced: true });
    runtime.sync(store.nodes);
    store.remove(id);
    runtime.sync(store.nodes);
    resolve({ scene, animations: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.root.children).toHaveLength(0);
  });
  it('renders regular models for incompatible skinned models, without repeatedly recreating them', async () => {
    const scene = new Group();
    scene.add(new SkinnedMesh(geometry, material));
    mocks.loadModel.mockResolvedValue({ scene, animations: [] });
    const id = store.add({ type: 'prop', name: 'Skinned prop', glb: 'Map/skinned.glb', instanced: true });
    runtime.sync(store.nodes);
    await vi.waitFor(() => expect(mocks.instantiate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(runtime.objectOf(id)?.children.length).toBe(1));
    const object = store.node(id)!.object;
    store.update(id, { position: [10, 0, 0] });
    runtime.sync(store.nodes);
    expect(store.node(id)!.object).toBe(object);
    expect(mocks.instantiate).toHaveBeenCalledTimes(1);
    expect(meshes()).toHaveLength(0);
  });
  it('keeps 10,000 placements in one shared batch, and does not upload unrelated instances on ordinary edits', async () => {
    const ids = await insert(10_000);
    expect(meshes()).toHaveLength(1);
    expect(mocks.loadModel).toHaveBeenCalledTimes(1);
    const mesh = meshes()[0];
    const object = store.node(ids[1])!.object;
    const originalVersion = mesh.instanceMatrix.version;
    store.update(ids[1], { position: [9, 0, 0] });
    runtime.sync(store.nodes);
    expect(store.node(ids[1])!.object).toBe(object);
    expect(mesh.instanceMatrix.version).toBe(originalVersion + 1);
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
    const version = mesh.instanceMatrix.version;
    store.update(ids[1], { name: 'Renamed' });
    runtime.sync(store.nodes);
    runtime.update(1 / 30);
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(mocks.instantiate).not.toHaveBeenCalled();
  }, 20_000);
});
