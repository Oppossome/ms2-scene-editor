import type { ClipInfo, EmoteRecord } from '../../types.js';

const emoteCache = new Map<string, Promise<EmoteRecord | null>>();

/** An emote's clips and effects (null when there is no such emote with effects). */
export function fetchEmote(id: string): Promise<EmoteRecord | null> {
  let hit = emoteCache.get(id);
  if (!hit) {
    hit = fetch(`/api/emotes/${encodeURIComponent(id)}`).then((r) =>
      r.ok
        ? (r.json() as Promise<EmoteRecord>)
        : r.status === 404
          ? null
          : Promise.reject(new Error(`HTTP ${r.status}`))
    );
    hit.catch(() => emoteCache.delete(id));
    emoteCache.set(id, hit);
  }
  return hit;
}

/**
 * The motion of an emote a model plays: the first with effects whose clip the model has (`clip` is the model's own
 * name for it), else the first whose clip it has (an emote: a couple emote lists both genders' clips), else the
 * first with effects (`clip` undefined: the effects then follow whatever the model plays).
 */
export function emoteMotion(
  clips: readonly ClipInfo[],
  emote: EmoteRecord
): { index: number; clip: string | undefined } {
  const own = (clip: string) => clips.find((c) => c.name.toLowerCase() === clip.toLowerCase())?.name;
  let index = emote.motions.findIndex((m) => withEffects(emote, m) && own(m.clip));
  if (index < 0) index = emote.motions.findIndex((m) => own(m.clip));
  if (index < 0)
    index = Math.max(
      0,
      emote.motions.findIndex((m) => withEffects(emote, m))
    );
  return { index, clip: own(emote.motions[index]?.clip ?? '') };
}

/** Whether a motion shows anything besides its clip (an instrument's props go with every motion). */
function withEffects(emote: EmoteRecord, motion: EmoteRecord['motions'][number]): boolean {
  return !!(motion.cast || motion.loop || emote.props?.length);
}

/** An emote row's detail line: its id and the clips its effects go with (an emote without effects: its clips). */
export function emoteDetail(emote: EmoteRecord): string {
  const shown = emote.motions.some((m) => withEffects(emote, m))
    ? emote.motions.filter((m) => withEffects(emote, m))
    : emote.motions;
  const clips = [...new Set(shown.map((m) => m.clip))];
  return [emote.id, clips.slice(0, 3).join(', ') + (clips.length > 3 ? '...' : '')].filter(Boolean).join(' - ');
}
