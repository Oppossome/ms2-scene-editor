import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneRuntime } from './runtime.svelte.js';
import { entity } from './testing.js';

const groupNode = (id: string, parentId: string | null) => entity(id, 'group', parentId);

describe('SceneRuntime group centering', () => {
  let runtime: SceneRuntime | undefined;
  let geometry: BoxGeometry | undefined;
  let material: MeshBasicMaterial | undefined;

  afterEach(() => {
    runtime?.dispose();
    geometry?.dispose();
    material?.dispose();
    runtime = undefined;
    geometry = undefined;
    material = undefined;
  });

  it('moves the group origin to the child bounds center while preserving child world transforms', () => {
    runtime = new SceneRuntime();
    runtime.sync([groupNode('parent', null), groupNode('group', 'parent'), groupNode('child', 'group')]);

    const parent = runtime.objectOf('parent') as Group;
    const group = runtime.objectOf('group') as Group;
    const child = runtime.objectOf('child') as Group;
    parent.position.set(-7, 3, 5);
    parent.rotation.set(0.2, -0.3, 0.1);
    parent.scale.set(1.5, 0.75, 2);
    group.position.set(10, -5, 2);
    group.rotation.z = Math.PI / 2;
    group.scale.set(2, 1, 1);
    child.position.set(3, 4, -2);
    geometry = new BoxGeometry(4, 2, 6);
    material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.position.set(2, -1, 3);
    child.add(mesh);

    child.updateWorldMatrix(true, true);
    const childWorld = child.matrixWorld.clone();
    const center = new Box3().setFromObject(mesh).getCenter(new Vector3());
    parent.updateWorldMatrix(true, false);
    const centerInParent = center.clone().applyMatrix4(parent.matrixWorld.clone().invert());
    const updates = runtime.groupCenterPositions('group');
    expect(updates).not.toBeNull();

    for (const update of updates!) {
      const object = runtime.objectOf(update.id)!;
      object.position.set(...update.position);
    }
    child.updateWorldMatrix(true, true);

    expect(group.position.toArray()).toEqual(centerInParent.toArray());
    child.matrixWorld.elements.forEach((value, i) => expect(value).toBeCloseTo(childWorld.elements[i], 10));
  });

  it('has no center for an empty group', () => {
    runtime = new SceneRuntime();
    runtime.sync([groupNode('group', null)]);
    expect(runtime.groupCenterPositions('group')).toBeNull();
  });
});
