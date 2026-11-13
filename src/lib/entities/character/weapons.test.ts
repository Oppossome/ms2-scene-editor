import { describe, expect, it } from 'vitest';
import { drawsWeapons, handNode, inHand } from './weapons';

const asset = (slot: string, targetnode: string, attachnode = '') => ({ slot, targetnode, attachnode });

describe('handNode', () => {
  it('puts carried weapons in the hand of their slot', () => {
    expect(handNode(asset('RH', 'Weapon_Side_L_Point'))).toBe('Weapon_Hand_R_Point');
    expect(handNode(asset('LH', 'Weapon_Back_B_Point'))).toBe('Weapon_Hand_L_Point');
    expect(handNode(asset('OH', 'Weapon_Side_L_Point'))).toBe('Weapon_Hand_R_Point');
  });

  it('prefers the hand point the item names', () => {
    expect(handNode(asset('RH', 'Weapon_Back_B_Point', 'Weapon_Hand_L_Point'))).toBe('Weapon_Hand_L_Point');
  });

  it('leaves anything that is not a carried weapon alone', () => {
    expect(handNode(asset('RH', 'Scene Root', 'Scene Root'))).toBeUndefined();
    expect(handNode(asset('RH', 'Weapon_Hand_R_Point'))).toBeUndefined();
    expect(handNode(asset('CP', 'Bip01 Head'))).toBeUndefined();
  });
});

describe('drawsWeapons', () => {
  it('draws for weapon and class clips', () => {
    expect(drawsWeapons('sword_attack_idle_a')).toBe(true);
    expect(drawsWeapons('LargeSword_Attack_01_A')).toBe(true);
    expect(drawsWeapons('knight_bore_a')).toBe(true);
  });

  it('keeps weapons carried otherwise', () => {
    expect(drawsWeapons('idle_a')).toBe(false);
    expect(drawsWeapons('attack_01_a')).toBe(false);
    expect(drawsWeapons('emotion_kiss_a')).toBe(false);
    expect(drawsWeapons('')).toBe(false);
  });
});

describe('inHand', () => {
  it('follows the clip unless the hold mode says otherwise', () => {
    expect(inHand(undefined, true)).toBe(true);
    expect(inHand('auto', false)).toBe(false);
    expect(inHand('hand', false)).toBe(true);
    expect(inHand('carry', true)).toBe(false);
  });
});
