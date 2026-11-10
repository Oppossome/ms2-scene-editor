import { describe, expect, it } from 'vitest';
import { bodyMeshesForSlot, conflictingItems, pickAssets } from './slots';
import type { ItemAsset } from '../../types';

const asset = (slot: string, glb: string, gender: 0 | 1 | 2): ItemAsset => ({
  slot,
  glb,
  gender,
  selfnode: '',
  targetnode: '',
  attachnode: '',
  replace: true,
  earfold: false,
  weapon: false
});

describe('bodyMeshesForSlot', () => {
  const names = ['HR', 'CL_Skin', 'CL_Bra', 'FA', 'FA_Skin', 'FA_EA', 'GL', 'PA_Skin', 'PA_Panty', 'SH', 'CLOAK'];
  it('matches the slot and its parts only', () => {
    expect(bodyMeshesForSlot('CL', names)).toEqual(['CL_Skin', 'CL_Bra']);
    expect(bodyMeshesForSlot('PA', names)).toEqual(['PA_Skin', 'PA_Panty']);
    expect(bodyMeshesForSlot('FA', names)).toEqual(['FA', 'FA_Skin', 'FA_EA']);
    expect(bodyMeshesForSlot('HR', names)).toEqual(['HR']);
    expect(bodyMeshesForSlot('CP', names)).toEqual([]);
  });
});

describe('pickAssets', () => {
  it('prefers assets made for the gender and falls back to unisex', () => {
    const item = {
      assets: [asset('CL', 'm.glb', 0), asset('CL', 'f.glb', 1), asset('PA', 'both.glb', 2), asset('PA', 'f2.glb', 1)]
    };
    expect(pickAssets(item, 1).map((a) => a.glb)).toEqual(['f.glb', 'f2.glb']);
    expect(pickAssets(item, 0).map((a) => a.glb)).toEqual(['m.glb', 'both.glb']);
  });

  it('returns nothing when no asset fits', () => {
    expect(pickAssets({ assets: [asset('CL', 'f.glb', 1)] }, 0)).toEqual([]);
  });
});

describe('conflictingItems', () => {
  it('lists owners of the new item slots once, excluding the item itself', () => {
    const owners = new Map([
      ['CL', 'dress'],
      ['PA', 'dress'],
      ['SH', 'boots']
    ]);
    expect(conflictingItems(owners, ['CL', 'PA'], 'coat')).toEqual(['dress']);
    expect(conflictingItems(owners, ['CL'], 'dress')).toEqual([]);
    expect(conflictingItems(owners, ['GL'], 'x')).toEqual([]);
  });
});
