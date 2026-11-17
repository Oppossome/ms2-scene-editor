import type { ClipInfo, SkillRecord } from '../../types.js';

const skillCache = new Map<string, Promise<SkillRecord | null>>();

/** A skill's clips and effects (null when there is no such skill with effects). */
export function fetchSkill(id: string): Promise<SkillRecord | null> {
  let hit = skillCache.get(id);
  if (!hit) {
    hit = fetch(`/api/skills/${encodeURIComponent(id)}`).then((r) =>
      r.ok
        ? (r.json() as Promise<SkillRecord>)
        : r.status === 404
          ? null
          : Promise.reject(new Error(`HTTP ${r.status}`))
    );
    hit.catch(() => skillCache.delete(id));
    skillCache.set(id, hit);
  }
  return hit;
}

/**
 * The motion of a skill a model plays: the first with effects whose clip the model has (`clip` is the model's own
 * name for it), else the first with effects (`clip` undefined: the effects then follow whatever the model plays).
 */
export function skillMotion(
  clips: readonly ClipInfo[],
  skill: SkillRecord
): { index: number; clip: string | undefined } {
  const own = (clip: string) => clips.find((c) => c.name.toLowerCase() === clip.toLowerCase())?.name;
  const withEffects = (m: SkillRecord['motions'][number]) => !!(m.cast || m.loop);
  let index = skill.motions.findIndex((m) => withEffects(m) && own(m.clip));
  if (index < 0) index = Math.max(0, skill.motions.findIndex(withEffects));
  return { index, clip: own(skill.motions[index]?.clip ?? '') };
}

/** A skill row's detail line: its id and the clips its effects go with. */
export function skillDetail(skill: SkillRecord): string {
  const clips = [...new Set(skill.motions.filter((m) => m.cast || m.loop).map((m) => m.clip))];
  return [skill.id, clips.slice(0, 3).join(', ') + (clips.length > 3 ? '...' : '')].filter(Boolean).join(' - ');
}
