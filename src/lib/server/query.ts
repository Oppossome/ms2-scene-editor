import type { Gender, ItemRecord, MapRecord, NpcRecord } from '../types.js';

export interface Page<T> {
  total: number;
  offset: number;
  items: T[];
}

function tokens(q: string | null | undefined): string[] {
  return (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function paginate<T>(all: T[], offset: number, limit: number): Page<T> {
  const o = Math.max(0, offset | 0);
  const l = Math.min(Math.max(1, limit | 0), 500);
  return { total: all.length, offset: o, items: all.slice(o, o + l) };
}

export interface ItemQuery {
  q?: string;
  slot?: string;
  cls?: string;
  gender?: Gender;
  limit?: number;
  offset?: number;
}

/** An item fits a gender when any of its assets is for that gender or for both. */
export function itemFitsGender(item: ItemRecord, gender: Gender): boolean {
  return item.assets.some((a) => a.gender === 2 || a.gender === gender);
}

export function searchItems(items: ItemRecord[], query: ItemQuery): Page<ItemRecord> {
  const words = tokens(query.q);
  const slot = query.slot?.toUpperCase();
  const cls = query.cls?.toLowerCase();
  const matched = items.filter((item) => {
    if (slot && !item.slots.includes(slot)) return false;
    if (cls && item.cls.toLowerCase() !== cls) return false;
    if (query.gender !== undefined && query.gender !== 2 && !itemFitsGender(item, query.gender)) return false;
    if (words.length) {
      const hay = `${item.name} ${item.cls} ${item.id}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  matched.sort((a, b) => Number(!a.cls) - Number(!b.cls) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const deduplicated = matched.filter((item) => {
    const key = JSON.stringify([...new Set(item.assets.map((asset) => asset.glb.toLowerCase()))].sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Items whose name is just their id (no entry in the string table) go last.
  const named = (i: ItemRecord) => (i.name === i.id ? 1 : 0);
  deduplicated.sort((a, b) => named(a) - named(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return paginate(deduplicated, query.offset ?? 0, query.limit ?? 60);
}

export function searchByName<T extends { id: string; name: string }>(
  records: T[],
  q: string | null | undefined,
  offset = 0,
  limit = 60
): Page<T> {
  const words = tokens(q);
  const matched = words.length
    ? records.filter((r) => {
        const hay = `${r.name} ${r.id}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : records.slice();
  matched.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return paginate(matched, offset, limit);
}

/** One entry of the NPC list: the NPCs that share a name and a model (the game has one per level) shown once. */
export interface NpcGroup extends NpcRecord {
  /** How many NPC records the entry stands for. */
  variants: number;
  /** Lowest and highest level among them. */
  levels: [number, number];
}

/**
 * Group NPCs with the same name and the same model. The entry is the lowest-level one (then the lowest id), so the
 * result does not depend on the order of the index; `ids` lists every id the entry stands for, for searching.
 */
export function groupNpcs(npcs: NpcRecord[]): { entry: NpcGroup; ids: string[] }[] {
  const groups = new Map<string, NpcRecord[]>();
  for (const npc of npcs) {
    const key = `${npc.name}\0${npc.glb}`;
    const list = groups.get(key);
    if (list) list.push(npc);
    else groups.set(key, [npc]);
  }
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
    const levels = sorted.map((n) => n.level);
    return {
      entry: { ...sorted[0], variants: list.length, levels: [Math.min(...levels), Math.max(...levels)] },
      ids: sorted.map((n) => n.id)
    };
  });
}

/** Search the grouped NPC list by name or by the id of any NPC in a group. */
export function searchNpcs(
  groups: { entry: NpcGroup; ids: string[] }[],
  q: string | null | undefined,
  offset = 0,
  limit = 60
): Page<NpcGroup> {
  const words = tokens(q);
  const matched = words.length
    ? groups.filter((g) => {
        const hay = `${g.entry.name} ${g.ids.join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : groups.slice();
  matched.sort((a, b) => a.entry.name.localeCompare(b.entry.name) || a.entry.id.localeCompare(b.entry.id));
  return paginate(
    matched.map((g) => g.entry),
    offset,
    limit
  );
}

export type { ItemRecord, MapRecord, NpcRecord };
