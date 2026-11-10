export type Vec3 = [number, number, number];

let counter = 0;
export function newId(): string {
  counter++;
  return `n${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export const ZERO: Vec3 = [0, 0, 0];
export const ONE: Vec3 = [1, 1, 1];

/** Types that can hold children: not items (the rig owns them) and not Lighting. */
export function canHaveChildren(type: string): boolean {
  return type !== 'item' && type !== 'lighting';
}
