import { describe, expect, it } from 'vitest';
import { ItemEntity, restoreEntity, type Entity } from './entity.svelte.js';
import { editableChannels, hasOwnColours, lastFrame, stepFrame, type PropContext } from './properties.js';

const node = (over: Record<string, unknown> = {}): Entity => restoreEntity({
  id: 'a', type: 'prop', name: 'Crate', parentId: null,
  position: [1, 2, 3], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1],
  visible: true, locked: false, glb: 'x.glb', gender: 1, itemId: '1', ...over
});
const ctx = (entity = node(), over: Partial<PropContext> = {}): PropContext => ({
  node: entity, clips: [], bones: [], defaultBone: '', skinned: false,
  palette: 0, channels: [true, true], ...over
});
const controls = (context: PropContext) => context.node.controls(context);
const row = (context: PropContext, key: string) => controls(context).find((row) => row.key === key)!;

describe('entity-owned controls', () => {
  it('describes transforms and converts rotation at the control boundary only', () => {
    const context = ctx();
    expect(row(context, 'rotation')).toMatchObject({ type: 'vec3', value: [0, 90, 0] });
    const rotation = row(context, 'rotation');
    if (rotation.type !== 'vec3') throw new Error('Expected vector control');
    expect(rotation.edit([0, 180, 0])).toEqual({ rotation: [0, Math.PI, 0] });
    expect(new Set(controls(context).map((row) => row.section))).toEqual(new Set(['Data', 'Transform', 'Appearance', 'Source', 'Behaviour']));
  });
  it('offers automatic/manual faces and appearance only on characters', () => {
    const context = ctx(node({ type: 'character', expression: 'smile' }));
    const expression = row(context, 'expression');
    expect(expression).toMatchObject({ type: 'enum', value: 'smile' });
    if (expression.type !== 'enum') throw new Error('Expected enum');
    expect(expression.options).toContainEqual({ value: '', label: 'Automatic (animation)' });
    expect(expression.edit('')).toEqual({ expression: undefined });
    expect(() => context.node.prepare(expression.edit('../file'))).toThrow(/expression/);
    expect(row(ctx(), 'expression')).toBeUndefined();
    expect(row(context, 'eye')).toMatchObject({ type: 'palette', value: 5, palette: 3, channel: 0 });
    expect(row(context, 'gender')).toMatchObject({ value: '1' });
    expect(row(context, 'skin')).toMatchObject({ palette: 1 });
  });
  it('clamps a held frame when choosing a shorter clip, and exposes live playback separately', () => {
    const context = ctx(node({ type: 'npc', clip: 'long', freeze: 80 }), {
      clips: [{ name: 'long', duration: 4 }, { name: 'short', duration: 1 }]
    });
    const clip = row(context, 'clip');
    if (clip.type !== 'clip') throw new Error('Expected clip picker');
    expect(clip.edit('short')).toEqual({ clip: 'short', freeze: 30 });
    expect(row(context, 'playback')).toMatchObject({ type: 'transport', frame: 80, max: 120 });
    expect(row(context, 'speed')).toMatchObject({ value: 1, min: 0.05 });
    expect(row(ctx(), 'clip')).toBeUndefined();
  });
  it('disables skinned offsets, but supports static item mounts and compound colour edits', () => {
    const item = node({ type: 'item', itemId: '9', slots: ['RH'], parentId: 'p', color: 3, channelColors: { ch2: 6 } });
    const parent = node({ type: 'character', id: 'p' });
    const context = ctx(item, { parent, bones: ['Bip01_R_Hand'], defaultBone: 'Weapon_R_Point', palette: 4 });
    expect(row(context, 'attachBone')).toMatchObject({
      options: [{ value: '', label: '(default: Weapon_R_Point)' }, { value: 'Bip01_R_Hand', label: 'Bip01 R Hand' }]
    });
    expect(row(context, 'position')).toMatchObject({ label: 'Offset' });
    expect(row(context, 'colorCh0')).toMatchObject({ channel: 0, value: 3 });
    expect(row(context, 'colorCh2')).toMatchObject({ channel: 2, value: 6 });
    expect(row(context, 'colorCh1')).toBeUndefined();
    expect(item).toBeInstanceOf(ItemEntity);
    if (!(item instanceof ItemEntity)) throw new Error('Expected item');
    expect(item.chooseColor(5)).toEqual({ color: 5, channelColors: undefined });
    const skinned = { ...context, skinned: true };
    expect(row(skinned, 'position').disabled).toMatch(/skeleton/);
    expect(row(skinned, 'attachBone')).toBeUndefined();
    expect(row(skinned, 'resetOffset')).toBeUndefined();
    expect(controls({ ...context, channels: [true, false] }).filter((row) => row.type === 'palette')).toHaveLength(1);
  });
  it('provides environment controls, not transforms, for Lighting', () => {
    const context = ctx(node({ type: 'lighting', environment: { background: 'sky.png', fog: { color: [1, 2, 3], near: 4, far: 9 } } }));
    expect(row(context, 'position')).toBeUndefined();
    expect(row(context, 'background')).toMatchObject({ value: 'sky.png' });
    expect(row(context, 'fogColor')).toMatchObject({ value: [1, 2, 3] });
  });
});

describe('shared property helpers', () => {
  it('matches palette channels and excludes face item colours', () => {
    expect(editableChannels([true, true])).toEqual([0, 2]);
    expect(editableChannels([false, false])).toEqual([]);
    expect(hasOwnColours({ slots: ['FA'] })).toBe(false);
    expect(hasOwnColours({ slots: ['CP'] })).toBe(true);
    expect(hasOwnColours(null)).toBe(false);
  });
  it('steps and wraps frames in either direction', () => {
    expect(lastFrame([{ name: 'idle', duration: 2 }], 'idle')).toBe(60);
    expect(lastFrame([], 'missing')).toBeUndefined();
    expect(stepFrame(0, -1, 60)).toBe(60);
    expect(stepFrame(60, 1, 60)).toBe(0);
    expect(stepFrame(2, -10)).toBe(0);
    expect(stepFrame(0, -10, 0)).toBe(0);
  });
});
