import type { ClipInfo } from '../types.js';
import { FRAME_RATE } from './model.js';
import type { Entity } from './entity.svelte.js';

export interface PropContext {
  node: Entity;
  parent?: Entity;
  clips: ClipInfo[];
  bones: string[];
  defaultBone: string;
  skinned: boolean;
  palette: number;
  channels: [main: boolean, detail: boolean];
}

export const BODY_PALETTE = 1;
export const EYE_PALETTE = 3;
export const hasOwnColours = (item: { slots: string[] } | null | undefined) => !!item && !item.slots.includes('FA');
export type PickChannel = 0 | 2;
export const CHANNEL_LABELS: Record<PickChannel, string> = { 0: 'Main', 2: 'Detail' };
export const editableChannels = (channels: [boolean, boolean]): PickChannel[] =>
  [...(channels[0] ? [0 as const] : []), ...(channels[1] ? [2 as const] : [])];

export function lastFrame(clips: ClipInfo[], name: string | undefined): number | undefined {
  const clip = clips.find((clip) => clip.name === name);
  return clip ? Math.max(0, Math.floor(clip.duration * FRAME_RATE)) : undefined;
}

export function stepFrame(frame: number, delta: number, last?: number): number {
  if (last === undefined) return Math.max(0, frame + delta);
  const length = last + 1;
  return ((frame + delta) % length + length) % length;
}
