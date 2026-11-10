/**
 * Shared scene constants. The scene itself is a flat list of entities (`entity.svelte.ts`) linked by `parentId`;
 * the array order is the sibling order. Bones are not entities: an entity is mounted on a bone of its parent
 * character through `attachBone`.
 */
export type Vec3 = [number, number, number];

export const SCENE_KEY = 'ms2se.scene.current';
/** Frames per second the clips are sampled at, so a frame number maps to a time. */
export const FRAME_RATE = 30;
export const DEFAULT_SKIN = 2;
export const DEFAULT_EYE = 5;

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

/** Snapshot-based undo/redo history. States are opaque strings (serialised scenes). */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Remember `state` as the point to return to; invalidates redo. */
  record(state: string) {
    if (this.past[this.past.length - 1] === state) return;
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
