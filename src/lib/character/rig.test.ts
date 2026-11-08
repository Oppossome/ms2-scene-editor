import { Group, Mesh, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ItemAsset, ItemRecord } from '../types';
import type { CharacterRig as Rig } from './rig';

vi.mock('../assets/loader.js', () => ({
  instantiate: vi.fn(async (rel: string) => {
    if (rel.includes('body')) {
      const root = new Group();
      root.name = 'Scene Root';
      const hip = new Object3D();
      hip.name = 'Bip01';
      const head = new Object3D();
      head.name = 'Bip01_Head';
      const hand = new Object3D();
      hand.name = 'Bip01_R_Hand';
      const hair = new Mesh();
      hair.name = 'HR';
      head.add(hair);
      hip.add(head, hand);
      root.add(hip);
      return { object: root, animations: [] };
    }
    const object = new Group();
    const sceneRoot = new Group();
    sceneRoot.name = 'Scene Root';
    const mesh = new Mesh();
    mesh.name = rel;
    sceneRoot.add(mesh);
    object.add(sceneRoot);
    return { object, animations: [] };
  })
}));

const { CharacterRig } = await import('./rig');

const asset = (slot: string, glb: string, over: Partial<ItemAsset> = {}): ItemAsset => ({
  slot,
  glb,
  gender: 2,
  selfnode: '',
  targetnode: 'Bip01 Head',
  attachnode: '',
  replace: false,
  earfold: false,
  weapon: false,
  ...over
});

const item = (id: string, assets: ItemAsset[]): ItemRecord => ({
  id,
  name: `item ${id}`,
  cls: '',
  icon: '',
  slots: [...new Set(assets.map((a) => a.slot))],
  assets,
  palette: 0,
  defaultColor: 0,
  type: 0,
  subtype: 0,
  category: ''
});

const hatA = item('1', [asset('CP', 'hat-a.glb')]);
const hatB = item('2', [asset('CP', 'hat-b.glb')]);
const hair = item('3', [asset('HR', 'hair.glb', { replace: true })]);
const sword = item('4', [asset('RH', 'sword.glb', { targetnode: 'Bip01 R Hand' })]);

const mountsUnder = (rig: Rig, id: string) => rig.mountsOf(id).map((m) => m.parent?.name);

describe('CharacterRig items', () => {
  it('equips static items on their bone through a mount group', async () => {
    const rig = await CharacterRig.create(1);
    await rig.equip(hatA);
    expect(mountsUnder(rig, '1')).toEqual(['Bip01_Head']);
    expect(rig.defaultBoneOf('1')).toBe('Bip01 Head');
    expect(rig.itemInSlot('CP')?.id).toBe('1');
  });

  it('hides replaced body parts and gives them back on unequip', async () => {
    const rig = await CharacterRig.create(1);
    const bodyHair = rig.bodyParts.get('HR')!;
    await rig.equip(hair);
    expect(bodyHair.visible).toBe(false);
    rig.unequip('3');
    expect(bodyHair.visible).toBe(true);
  });

  it('mounts an item on another bone and back to its default', async () => {
    const rig = await CharacterRig.create(1);
    await rig.equip(sword);
    expect(mountsUnder(rig, '4')).toEqual(['Bip01_R_Hand']);
    rig.mountOn('4', 'Bip01 Head');
    expect(mountsUnder(rig, '4')).toEqual(['Bip01_Head']);
    rig.mountOn('4', '');
    expect(mountsUnder(rig, '4')).toEqual(['Bip01_R_Hand']);
    rig.mountOn('4', 'No such bone');
    expect(mountsUnder(rig, '4')).toEqual(['Bip01_R_Hand']);
  });

  it('hides and shows an item together with its body parts', async () => {
    const rig = await CharacterRig.create(1);
    const bodyHair = rig.bodyParts.get('HR')!;
    await rig.equip(hair);
    const mount = rig.mountsOf('3')[0];
    rig.setItemVisible('3', false);
    expect(bodyHair.visible).toBe(true);
    expect(mount.visible).toBe(false);
    rig.setItemVisible('3', true);
    expect(bodyHair.visible).toBe(false);
    expect(mount.visible).toBe(true);
  });
});

describe('CharacterRig preview', () => {
  it('shows a preview without wearing it, and clears it', async () => {
    const rig = await CharacterRig.create(1);
    await rig.previewEquip(hatA);
    expect(rig.previewing).toBe(true);
    expect(rig.isEquipped('1')).toBe(false);
    expect(rig.slotOwner.size).toBe(0);
    const head = rig.resolve('Bip01 Head')!;
    expect(head.children.some((c) => c instanceof Group)).toBe(true);
    rig.clearPreview();
    expect(rig.previewing).toBe(false);
    expect(head.children.some((c) => c instanceof Group)).toBe(false);
  });

  it('covers the worn item of the same slot and restores it afterwards', async () => {
    const rig = await CharacterRig.create(1);
    await rig.equip(hatA);
    const worn = rig.mountsOf('1')[0];
    await rig.previewEquip(hatB);
    expect(worn.visible).toBe(false);
    expect(rig.isEquipped('1')).toBe(true);
    rig.clearPreview();
    expect(worn.visible).toBe(true);
  });

  it('swaps one preview for the next', async () => {
    const rig = await CharacterRig.create(1);
    await rig.previewEquip(hatA);
    await rig.previewEquip(hatB);
    const head = rig.resolve('Bip01 Head')!;
    expect(head.children.filter((c) => c instanceof Group)).toHaveLength(1);
  });

  it('restores body parts hidden by a covered item and re-hides them on the next state', async () => {
    const rig = await CharacterRig.create(1);
    const bodyHair = rig.bodyParts.get('HR')!;
    await rig.equip(hair);
    expect(bodyHair.visible).toBe(false);
    const other = item('5', [asset('HR', 'hair2.glb', { replace: true })]);
    await rig.previewEquip(other);
    expect(bodyHair.visible).toBe(false); // the preview replaces it too
    rig.clearPreview();
    expect(bodyHair.visible).toBe(false); // the worn hair is back
    rig.unequip('3');
    expect(bodyHair.visible).toBe(true);
  });

  it('is dropped when the item is equipped for real', async () => {
    const rig = await CharacterRig.create(1);
    await rig.previewEquip(hatA);
    await rig.equip(hatA);
    expect(rig.previewing).toBe(false);
    const head = rig.resolve('Bip01 Head')!;
    expect(head.children.filter((c) => c instanceof Group)).toHaveLength(1);
  });

  it('a slow preview that was cleared in the meantime never appears', async () => {
    const rig = await CharacterRig.create(1);
    const pending = rig.previewEquip(hatA);
    rig.clearPreview();
    await pending;
    expect(rig.previewing).toBe(false);
  });

  it('a preview is removed when the rig is disposed', async () => {
    const rig = await CharacterRig.create(1);
    await rig.previewEquip(hatA);
    rig.dispose();
    expect(rig.previewing).toBe(false);
  });
});

describe('CharacterRig.boneTree', () => {
  it('lists the body skeleton without meshes or item objects', async () => {
    const rig = await CharacterRig.create(1);
    await rig.equip(hatA);
    const tree = rig.boneTree();
    const names = (list: typeof tree): string[] => list.flatMap((b) => [b.name, ...names(b.children)]);
    expect(names(tree)).toEqual(['Bip01', 'Bip01_Head', 'Bip01_R_Hand']);
  });
});
