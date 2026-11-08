import { describe, expect, it } from 'vitest';
import type { SceneNode } from './model';
import { applyChange, describeBone, describeNode, RAD, type PropContext } from './properties';

const node = (over: Partial<SceneNode> = {}): SceneNode => ({
  id: 'a',
  kind: 'prop',
  name: 'Crate',
  parentId: null,
  position: [1, 2, 3],
  rotation: [0, Math.PI / 2, 0],
  scale: [1, 1, 1],
  visible: true,
  locked: false,
  glb: 'x.glb',
  ...over
});

const ctx = (n: SceneNode, over: Partial<PropContext> = {}): PropContext => ({
  node: n,
  path: [n.name],
  clips: [],
  bones: [],
  defaultBone: '',
  skinned: false,
  palette: 0,
  channels: [true, true],
  ...over
});

const sections = (c: PropContext) => describeNode(c).map((s) => s.section);
const row = (c: PropContext, key: string) => describeNode(c).flatMap((s) => s.rows).find((r) => r.key === key);

describe('describeNode', () => {
  it('shows Data, Transform, Appearance, Source and Behaviour for a prop', () => {
    expect(sections(ctx(node()))).toEqual(['Data', 'Transform', 'Appearance', 'Source', 'Behaviour']);
  });

  it('shows rotation in degrees', () => {
    expect(row(ctx(node()), 'rotation')?.value).toEqual([0, 90, 0]);
  });

  it('adds Animation when the node has clips', () => {
    const c = ctx(node({ clip: 'idle' }), { clips: [{ name: 'idle', duration: 2 }, { name: 'walk', duration: 0.8 }] });
    expect(sections(c)).toContain('Animation');
    expect(row(c, 'clip')).toMatchObject({ type: 'clip', value: 'idle' });
    expect(row(c, 'clip')?.clips?.map((x) => x.name)).toEqual(['idle', 'walk']);
    expect(row(c, 'speed')?.value).toBe(1);
  });

  it('offers an eye colour from the face palette, showing the main colour of each row', () => {
    const c = ctx(node({ kind: 'character', glb: undefined, gender: 1, eye: 7 }));
    expect(row(c, 'eye')).toMatchObject({ label: 'Eye colour', type: 'palette', value: 7, palette: 3, channel: 0 });
    expect(row(ctx(node({ kind: 'character', glb: undefined, gender: 1 })), 'eye')?.value).toBe(5);
    expect(row(ctx(node({ kind: 'prop' })), 'eye')).toBeUndefined();
  });

  it('offers gender and skin for characters', () => {
    const c = ctx(node({ kind: 'character', glb: undefined, gender: 0, skin: 3 }));
    expect(row(c, 'gender')?.value).toBe('0');
    expect(row(c, 'skin')).toMatchObject({ type: 'palette', value: 3 });
  });

  it('lets a static item pick a bone and reset its offset', () => {
    const parent = node({ id: 'p', kind: 'character', glb: undefined, gender: 1 });
    const item = node({ kind: 'item', glb: undefined, parentId: 'p', itemId: '9', slots: ['RH'] });
    const c = ctx(item, { parent, bones: ['Bip01_R_Hand'], defaultBone: 'Weapon_R_Point', palette: 4 });
    expect(sections(c)).toContain('Attachment');
    expect(row(c, 'attachBone')?.options?.[0].label).toBe('(default: Weapon_R_Point)');
    expect(row(c, 'attachBone')?.options?.[1]).toEqual({ value: 'Bip01_R_Hand', label: 'Bip01 R Hand' });
    expect(row(c, 'resetOffset')?.type).toBe('action');
    expect(row(c, 'position')?.label).toBe('Offset');
    expect(row(c, 'color')).toMatchObject({ type: 'palette', palette: 4 });
    expect(row(c, 'slots')?.value).toBe('RH');
  });

  it('shows skinned clothes without an editable offset or bone', () => {
    const parent = node({ id: 'p', kind: 'character', glb: undefined, gender: 1 });
    const item = node({ kind: 'item', glb: undefined, parentId: 'p', itemId: '9' });
    const c = ctx(item, { parent, skinned: true });
    expect(row(c, 'position')?.disabled).toMatch(/skeleton/);
    expect(row(c, 'attachBone')).toBeUndefined();
    expect(row(c, 'resetOffset')).toBeUndefined();
  });

  it('lets any child of a character be mounted on a bone', () => {
    const parent = node({ id: 'p', kind: 'character', glb: undefined, gender: 1 });
    const c = ctx(node({ parentId: 'p' }), { parent, bones: ['A'] });
    expect(row(c, 'attachBone')?.options?.[0].label).toBe('(character root)');
    expect(row(ctx(node({ parentId: 'g' }), { parent: node({ id: 'g', kind: 'group', glb: undefined }) }), 'attachBone')).toBeUndefined();
  });

  it('names the parent', () => {
    expect(row(ctx(node()), 'parent')?.value).toBe('(scene)');
    expect(row(ctx(node({ parentId: 'g' }), { parent: node({ id: 'g', name: 'Group', kind: 'group' }) }), 'parent')?.value).toBe('Group');
  });
});

describe('per-channel colour rows', () => {
  const parent = node({ id: 'p', kind: 'character', glb: undefined, gender: 1 });
  const hat = (over: Partial<SceneNode> = {}) => node({ kind: 'item', glb: undefined, parentId: 'p', itemId: '9', ...over });
  const colorRows = (c: PropContext) => describeNode(c).flatMap((s) => s.rows).filter((r) => r.type === 'palette').map((r) => r.key);

  it('adds a row per allowed channel when more than one is allowed', () => {
    const c = ctx(hat({ color: 3, channelColors: { ch2: 6 } }), { parent, palette: 2, channels: [true, true] });
    expect(colorRows(c)).toEqual(['color', 'colorCh0', 'colorCh2']);
    expect(row(c, 'color')?.label).toBe('Colour set');
    expect(row(c, 'colorCh0')).toMatchObject({ label: 'Main', channel: 0, value: 3, palette: 2 });
    expect(row(c, 'colorCh2')).toMatchObject({ label: 'Detail', channel: 2, value: 6 });
  });

  it('has no accent row; only main and detail can be picked', () => {
    const c = ctx(hat(), { parent, palette: 2, channels: [true, true] });
    expect(colorRows(c)).not.toContain('colorCh1');
    expect(applyChange('colorCh1', 3)).toBeNull();
  });

  it('keeps a single plain colour row for items with one editable channel or none', () => {
    const one = ctx(hat(), { parent, palette: 2, channels: [true, false] });
    expect(colorRows(one)).toEqual(['color']);
    expect(row(one, 'color')?.label).toBe('Colour');
    expect(colorRows(ctx(hat(), { parent, palette: 0 }))).toEqual([]);
  });
});

describe('freezing an animation', () => {
  const clips = [{ name: 'idle_a', duration: 2.1 }];
  const rows = (n: SceneNode, withClips = clips) => describeNode(ctx(n, { clips: withClips })).flatMap((s) => s.rows);

  it('offers a Freeze switch, and the frame only while frozen', () => {
    const playing = rows(node({ kind: 'character', glb: undefined, gender: 1, clip: 'idle_a' }));
    expect(playing.find((r) => r.key === 'freeze')).toMatchObject({ type: 'bool', value: false });
    expect(playing.find((r) => r.key === 'frame')).toBeUndefined();
    const frozen = rows(node({ kind: 'character', glb: undefined, gender: 1, clip: 'idle_a', freeze: 12 }));
    expect(frozen.find((r) => r.key === 'freeze')?.value).toBe(true);
    expect(frozen.find((r) => r.key === 'frame')).toMatchObject({ type: 'number', value: 12, min: 0, max: 63, step: 1 });
  });

  it('has no freeze rows for nodes without animations', () => {
    expect(rows(node({ kind: 'prop' }), []).some((r) => r.key === 'freeze')).toBe(false);
  });

  it('freezes on the current frame, or releases', () => {
    expect(applyChange('freeze', true, undefined, 17)).toEqual({ freeze: 17 });
    expect(applyChange('freeze', true)).toEqual({ freeze: 0 });
    expect(applyChange('freeze', false, undefined, 17)).toEqual({ freeze: undefined });
    expect(applyChange('freeze', 'x')).toBeNull();
  });

  it('sets the frame to a whole, non-negative number', () => {
    expect(applyChange('frame', 8)).toEqual({ freeze: 8 });
    expect(applyChange('frame', 0)).toEqual({ freeze: 0 });
    expect(applyChange('frame', -1)).toBeNull();
    expect(applyChange('frame', 1.5)).toBeNull();
  });
});

describe('applyChange', () => {
  it('sets one channel and keeps the others', () => {
    const n = node({ kind: 'item', channelColors: { ch0: 2 } });
    expect(applyChange('colorCh2', 5, n)).toEqual({ channelColors: { ch0: 2, ch2: 5 } });
    expect(applyChange('colorCh0', 7, n)).toEqual({ channelColors: { ch0: 7 } });
    expect(applyChange('colorCh2', 5)).toEqual({ channelColors: { ch2: 5 } });
    expect(applyChange('colorCh0', -1, n)).toBeNull();
    expect(applyChange('colorCh2', 'x', n)).toBeNull();
  });

  it('picking a colour set resets the channel picks', () => {
    expect(applyChange('color', 4)).toEqual({ color: 4, channelColors: undefined });
    expect(applyChange('color', -2)).toBeNull();
  });

  it('converts rotation back to radians', () => {
    const patch = applyChange('rotation', [0, 90, 0]);
    expect(patch?.rotation?.[1]).toBeCloseTo(Math.PI / 2);
    expect(RAD).toBeCloseTo(57.29578);
  });

  it('validates values', () => {
    expect(applyChange('position', [1, 2, 'x'])).toBeNull();
    expect(applyChange('position', [1, 2])).toBeNull();
    expect(applyChange('position', [1, 2, NaN])).toBeNull();
    expect(applyChange('name', '  ')).toBeNull();
    expect(applyChange('name', ' Box ')).toEqual({ name: 'Box' });
    expect(applyChange('speed', 0)).toBeNull();
    expect(applyChange('speed', 2)).toEqual({ speed: 2 });
    expect(applyChange('skin', -1)).toBeNull();
    expect(applyChange('skin', 3)).toEqual({ skin: 3 });
    expect(applyChange('eye', 4)).toEqual({ eye: 4 });
    expect(applyChange('eye', -1)).toBeNull();
    expect(applyChange('eye', 'x')).toBeNull();
    expect(applyChange('visible', 'no')).toBeNull();
    expect(applyChange('locked', true)).toEqual({ locked: true });
    expect(applyChange('unknown', 1)).toBeNull();
  });

  it('maps enums', () => {
    expect(applyChange('gender', '0')).toEqual({ gender: 0 });
    expect(applyChange('gender', '2')).toBeNull();
    expect(applyChange('clip', '')).toEqual({ clip: undefined });
    expect(applyChange('clip', 'walk')).toEqual({ clip: 'walk' });
    expect(applyChange('attachBone', '')).toEqual({ attachBone: undefined });
    expect(applyChange('attachBone', 'Bip01_Head')).toEqual({ attachBone: 'Bip01_Head' });
  });
});

describe('describeBone', () => {
  it('describes a bone', () => {
    const [s] = describeBone('Hero', 'Bip01_R_Hand', 3);
    expect(s.rows.map((r) => r.value)).toEqual(['Bip01 R Hand', 'Bone', 'Hero', '3']);
  });
});
