import { Color, Group, Mesh, Object3D } from 'three';
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

vi.mock('./tint.js', async (original) => {
  const actual = await original<typeof import('./tint')>();
  return {
    ...actual,
    applyTint: vi.fn(async () => ({ active: true, setColors: vi.fn(), setSkinColors: vi.fn() }))
  };
});

const { CharacterRig } = await import('./rig');
const { applyTint } = await import('./tint');

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
  channels: [false, false],
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

describe('CharacterRig.boneTree', () => {
  it('lists the body skeleton without meshes or item objects', async () => {
    const rig = await CharacterRig.create(1);
    await rig.equip(hatA);
    const tree = rig.boneTree();
    const names = (list: typeof tree): string[] => list.flatMap((b) => [b.name, ...names(b.children)]);
    expect(names(tree)).toEqual(['Bip01', 'Bip01_Head', 'Bip01_R_Hand']);
  });
});

describe('CharacterRig skin colours', () => {
  const colors = (hex: number) => ({ c0: new Color(hex), c1: new Color(hex), c2: new Color(hex) });
  const shoes = item('7', [asset('SH', 'shoes.glb', { targetnode: 'Bip01 Head' })]);
  const calls = () => vi.mocked(applyTint).mock.calls;

  it('tints the body with the skin colours for both its own and the skin regions', async () => {
    vi.mocked(applyTint).mockClear();
    const skin = colors(0xffccaa);
    await CharacterRig.create(1, skin);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].slice(2)).toEqual([skin, skin]);
  });

  it('tints the face\'s own mask with the eye colours and the skin regions with the skin', async () => {
    vi.mocked(applyTint).mockClear();
    const skin = colors(0xffccaa);
    const eye = colors(0x2244aa);
    await CharacterRig.create(1, skin, eye);
    expect(calls()[0].slice(2)).toEqual([eye, skin]);
  });

  it('changes the eye colours without touching the skin, once they are set', async () => {
    const skin = colors(0xffccaa);
    const eye = colors(0x2244aa);
    const handle = { active: true, setColors: vi.fn(), setSkinColors: vi.fn() };
    vi.mocked(applyTint).mockResolvedValueOnce(handle);
    const rig = await CharacterRig.create(1, skin, eye);
    const next = colors(0x00ff00);
    rig.setEyeColors(next);
    expect(handle.setColors).toHaveBeenLastCalledWith(next);
    handle.setColors.mockClear();
    rig.setSkinColors(colors(0x111111));
    expect(handle.setColors).not.toHaveBeenCalled();
    expect(handle.setSkinColors).toHaveBeenCalled();
  });

  it('gives a worn item the character skin for its skin regions, even without item colours', async () => {
    const skin = colors(0xffccaa);
    const rig = await CharacterRig.create(1, skin);
    vi.mocked(applyTint).mockClear();
    await rig.equip(shoes);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]).toBe('shoes.glb');
    expect(calls()[0].slice(2)).toEqual([null, skin]);
  });

  it('passes item colours too when the item has them', async () => {
    const skin = colors(0xffccaa);
    const palette = colors(0x3355ff);
    const rig = await CharacterRig.create(1, skin);
    vi.mocked(applyTint).mockClear();
    await rig.equip(shoes, palette);
    expect(calls()[0].slice(2)).toEqual([palette, skin]);
  });

  it('does not tint an item at all without skin or item colours', async () => {
    const rig = await CharacterRig.create(1);
    vi.mocked(applyTint).mockClear();
    await rig.equip(shoes);
    expect(calls()).toHaveLength(0);
  });

  it('pushes a new skin colour to the body and to every worn item', async () => {
    const rig = await CharacterRig.create(1, colors(0xffccaa));
    await rig.equip(shoes);
    const handles = await Promise.all(vi.mocked(applyTint).mock.results.map((r) => r.value));
    const bodyHandle = handles[0];
    const itemHandle = handles[handles.length - 1];
    vi.mocked(bodyHandle.setSkinColors).mockClear();
    vi.mocked(itemHandle.setSkinColors).mockClear();
    const darker = colors(0x6b4a33);
    rig.setSkinColors(darker);
    expect(bodyHandle.setSkinColors).toHaveBeenCalledWith(darker);
    expect(bodyHandle.setColors).toHaveBeenCalledWith(darker);
    expect(itemHandle.setSkinColors).toHaveBeenCalledWith(darker);
  });

  it('gives items worn after a skin change the new colour', async () => {
    const rig = await CharacterRig.create(1, colors(0xffccaa));
    const darker = colors(0x6b4a33);
    rig.setSkinColors(darker);
    vi.mocked(applyTint).mockClear();
    await rig.equip(shoes);
    expect(calls()[0].slice(2)).toEqual([null, darker]);
  });
});
