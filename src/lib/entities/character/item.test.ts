import { describe, expect, it } from 'vitest';
import { CharacterEntity } from './character.svelte.js';
import { ItemEntity } from './item.svelte.js';
import { controlContext, controlRow } from '../testing.js';

describe('ItemEntity controls', () => {
  it('disables skinned offsets, but supports static item mounts and compound colour edits', () => {
    const item = new ItemEntity();
    item.set({ itemId: '9', slots: ['RH'], parentId: 'p', color: 3, channelColors: { ch2: 6 } });
    const parent = new CharacterEntity({ id: 'p' });
    const context = controlContext(item, { parent, bones: ['Bip01_R_Hand'], defaultBone: 'Weapon_R_Point', palette: 4 });
    expect(controlRow(context, 'attachBone')).toMatchObject({
      options: [{ value: '', label: '(default: Weapon_R_Point)' }, { value: 'Bip01_R_Hand', label: 'Bip01 R Hand' }]
    });
    expect(controlRow(context, 'position')).toMatchObject({ label: 'Offset' });
    expect(controlRow(context, 'colorCh0')).toMatchObject({ channel: 0, value: 3 });
    expect(controlRow(context, 'colorCh2')).toMatchObject({ channel: 2, value: 6 });
    expect(item.controls(context).find((control) => control.key === 'colorCh1')).toBeUndefined();
    expect(item).toBeInstanceOf(ItemEntity);
    expect(item.chooseColor(5)).toEqual({ color: 5, channelColors: undefined });
    const skinned = { ...context, skinned: true };
    expect(controlRow(skinned, 'position').disabled).toMatch(/skeleton/);
    expect(item.controls(skinned).find((control) => control.key === 'attachBone')).toBeUndefined();
    expect(item.controls(skinned).find((control) => control.key === 'resetOffset')).toBeUndefined();
    expect(item.controls({ ...context, channels: [true, false] }).filter((row) => row.type === 'palette')).toHaveLength(1);
  });
});
