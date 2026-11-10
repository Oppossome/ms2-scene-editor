import type { ClipInfo } from '../types.js';

/** Frames per second the clips are sampled at. */
export const FRAME_RATE = 30;

export function lastFrame(clips: ClipInfo[], name: string | undefined): number | undefined {
  const clip = clips.find((clip) => clip.name === name);
  return clip ? Math.max(0, Math.floor(clip.duration * FRAME_RATE)) : undefined;
}

export function stepFrame(frame: number, delta: number, last?: number): number {
  if (last === undefined) return Math.max(0, frame + delta);
  const length = last + 1;
  return ((frame + delta) % length + length) % length;
}
