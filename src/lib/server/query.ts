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
  // Items whose name is just their id (no entry in the string table) go last.
  const named = (i: ItemRecord) => (i.name === i.id ? 1 : 0);
  matched.sort((a, b) => named(a) - named(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return paginate(matched, query.offset ?? 0, query.limit ?? 60);
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

export type { ItemRecord, MapRecord, NpcRecord };
