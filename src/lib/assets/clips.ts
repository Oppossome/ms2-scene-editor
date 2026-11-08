import type { ClipInfo } from '../types.js';

const cache = new Map<0 | 1, Promise<ClipInfo[]>>();

/** The animation clips of a body model with their durations (one request per gender, then cached). */
export function fetchBodyClips(gender: 0 | 1): Promise<ClipInfo[]> {
  let hit = cache.get(gender);
  if (!hit) {
    hit = fetch(`/api/clips?gender=${gender}`).then((res) => {
      if (!res.ok) throw new Error(`clips: ${res.status}`);
      return res.json() as Promise<ClipInfo[]>;
    });
    // Let a later call retry after a failure.
    hit.catch(() => cache.delete(gender));
    cache.set(gender, hit);
  }
  return hit;
}

/** The clips embedded in a loaded model. */
export function embeddedClips(animations: { name: string; duration: number }[]): ClipInfo[] {
  return animations.map((c) => ({ name: c.name, duration: Math.round(c.duration * 1000) / 1000 }));
}

/** The clip a freshly placed model should start on: its idle animation, if it has one. */
export function idleClip(clips: ClipInfo[]): string | undefined {
  return clips.find((c) => /^idle/i.test(c.name))?.name;
}
