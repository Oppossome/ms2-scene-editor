import type { ClipInfo } from '../../types.js';

export interface ClipGroup {
  id: string;
  label: string;
  clips: ClipInfo[];
}

/** Lists shorter than this are shown flat; grouping 11 NPC clips would only get in the way. */
export const GROUP_THRESHOLD = 30;
/** A name prefix needs this many clips to be a group of its own; the rest go to "Other". */
export const MIN_GROUP = 4;

/** Prefixes of the everyday body clips (idle_a, run_a, jump_up_a, climb_*, damg_a...), pinned first. */
const BASIC_PREFIXES = new Set(['idle', 'walk', 'run', 'jump', 'climb', 'dash', 'swim', 'damg', 'dead']);

const prefixOf = (name: string) => name.split('_')[0].toLowerCase();
const byName = (a: ClipInfo, b: ClipInfo) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Groups clips by the first `_` token of their name (the game's own naming: `emotion_kiss_a`, `ride_run_024`,
 * `knight_lightbringer_a`). Everyday movement clips are pinned first as "Basic", then groups by size, and small
 * prefixes are collected in "Other". Short lists come back as a single group with no label.
 */
export function groupClips(clips: ClipInfo[]): ClipGroup[] {
  const sorted = [...clips].sort(byName);
  if (sorted.length < GROUP_THRESHOLD) return sorted.length ? [{ id: 'all', label: '', clips: sorted }] : [];

  const basic: ClipInfo[] = [];
  const byPrefix = new Map<string, ClipInfo[]>();
  for (const clip of sorted) {
    const prefix = prefixOf(clip.name);
    if (BASIC_PREFIXES.has(prefix)) {
      basic.push(clip);
      continue;
    }
    const list = byPrefix.get(prefix) ?? [];
    list.push(clip);
    byPrefix.set(prefix, list);
  }

  const groups: ClipGroup[] = [];
  const other: ClipInfo[] = [];
  for (const [prefix, list] of byPrefix) {
    if (list.length >= MIN_GROUP) groups.push({ id: prefix, label: capitalize(prefix), clips: list });
    else other.push(...list);
  }
  groups.sort((a, b) => b.clips.length - a.clips.length || (a.id < b.id ? -1 : 1));

  const out: ClipGroup[] = [];
  if (basic.length) out.push({ id: '#basic', label: 'Basic', clips: basic });
  out.push(...groups);
  if (other.length) out.push({ id: '#other', label: 'Other', clips: other.sort(byName) });
  return out;
}

/** Clips whose name contains every whitespace-separated term (case-insensitive; `_` counts as a space). */
export function filterClips(clips: ClipInfo[], query: string): ClipInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return clips;
  return clips.filter((c) => {
    const name = c.name.toLowerCase();
    const spaced = name.replace(/_/g, ' ');
    return terms.every((t) => name.includes(t) || spaced.includes(t));
  });
}

/** The id of the group holding a clip, or null. */
export function groupOf(groups: ClipGroup[], name: string): string | null {
  return groups.find((g) => g.clips.some((c) => c.name === name))?.id ?? null;
}

/** `0.8s`, `12s`, `1:05`; empty when the length is unknown. */
export function formatDuration(seconds: number): string {
  if (!(seconds > 0)) return '';
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
