import type { ItemAsset } from '../../types.js';

/**
 * Weapons in the game sit on a carry point (the asset's `targetnode`: `Weapon_Side_L_Point`, `Weapon_Back_B_Point`...)
 * and move to a hand point for combat. The body clips animate both hand points, so a weapon parented to one follows
 * the swing. The item data only names the carry point; the hand comes from `attachnode` where the game sets it
 * (knuckles) and otherwise from the slot.
 */

/** How a worn weapon is held: following the clip, always in hand, or always on its carry point. */
export const HOLD_MODES = ['auto', 'hand', 'carry'] as const;
export type HoldMode = (typeof HOLD_MODES)[number];

const HAND_BY_SLOT: Record<string, string> = {
  RH: 'Weapon_Hand_R_Point',
  LH: 'Weapon_Hand_L_Point',
  OH: 'Weapon_Hand_R_Point'
};

const isHandPoint = (node: string) => /^weapon_hand_[lr]_point$/i.test(node.replace(/ /g, '_'));
const isCarryPoint = (node: string) => /^weapon_(side|back)_[a-z]+_point$/i.test(node.replace(/ /g, '_'));

/** The hand point a weapon asset moves to in combat, or undefined for anything that is not a carried weapon. */
export function handNode(asset: Pick<ItemAsset, 'slot' | 'targetnode' | 'attachnode'>): string | undefined {
  if (!isCarryPoint(asset.targetnode)) return undefined;
  if (isHandPoint(asset.attachnode)) return asset.attachnode;
  return HAND_BY_SLOT[asset.slot];
}

/**
 * Clip families that hold the weapon: the `actionprefix` values of `Xml/table/weaponaction.xml` (Blunt_, Sword_,
 * LargeSword_...), the class skill clips and the object-weapon clips.
 */
const COMBAT_PREFIXES = new Set([
  'blunt',
  'dagger',
  'sword',
  'sceptre',
  'star',
  'largesword',
  'bow',
  'staff',
  'cannon',
  'blade',
  'knuckle',
  'orb',
  'heavygun',
  'objectweapon',
  'knight',
  'berserker',
  'wizard',
  'priest',
  'ranger',
  'heavygunner',
  'thief',
  'assassin',
  'runeblader',
  'striker',
  'soulbinder'
]);

/** Whether a body clip is a combat clip, during which weapons are held instead of carried. */
export function drawsWeapons(clip: string): boolean {
  return COMBAT_PREFIXES.has(clip.toLowerCase().split('_')[0]);
}

/** Whether a weapon with this hold mode is in the hand, given whether the current clip draws weapons. */
export function inHand(mode: HoldMode | undefined, drawn: boolean): boolean {
  return mode === 'hand' || (mode !== 'carry' && drawn);
}
