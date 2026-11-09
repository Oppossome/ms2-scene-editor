import { parseChannelIndexes, type ChannelIndexes } from '../character/tint.js';
import { isFaceExpression, type FaceExpression } from '../character/expressions.js';

/** Saved outfits (localStorage). An outfit is what a character node wears, see `nodesToOutfit`. */

export interface OutfitSnapshot {
  version: 1;
  gender: 0 | 1;
  /** Skin palette colour index. */
  skin: number;
  /** Eye colour (palette 3 index); outfits saved before it existed have none. */
  eye?: number;
  expression?: FaceExpression;
  items: { id: string; color?: number; channels?: ChannelIndexes }[];
}

export const SAVED_KEY = 'ms2se.outfit.saved';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Validate untrusted JSON into a snapshot; returns null when it is not usable. */
export function parseSnapshot(data: unknown): OutfitSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return null;
  if (d.gender !== 0 && d.gender !== 1) return null;
  const skin = typeof d.skin === 'number' && Number.isInteger(d.skin) && d.skin >= 0 ? d.skin : 0;
  if (!Array.isArray(d.items)) return null;
  const items: OutfitSnapshot['items'] = [];
  for (const raw of d.items) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^\d+$/.test(r.id)) return null;
    const entry: OutfitSnapshot['items'][number] = { id: r.id };
    if (typeof r.color === 'number' && Number.isInteger(r.color) && r.color >= 0) entry.color = r.color;
    const channels = parseChannelIndexes(r.channels);
    if (channels) entry.channels = channels;
    items.push(entry);
  }
  const eye = typeof d.eye === 'number' && Number.isInteger(d.eye) && d.eye >= 0 ? d.eye : undefined;
  return { version: 1, gender: d.gender, skin, ...(eye !== undefined ? { eye } : {}), ...(isFaceExpression(d.expression) ? { expression: d.expression } : {}), items };
}

export function parseSnapshotJson(text: string): OutfitSnapshot | null {
  try {
    return parseSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export function loadSaved(storage: StorageLike): Record<string, OutfitSnapshot> {
  const raw = storage.getItem(SAVED_KEY);
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, OutfitSnapshot> = {};
    for (const [name, value] of Object.entries(obj)) {
      const snap = parseSnapshot(value);
      if (snap) out[name] = snap;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveNamed(storage: StorageLike, name: string, snapshot: OutfitSnapshot) {
  const saved = loadSaved(storage);
  saved[name] = snapshot;
  storage.setItem(SAVED_KEY, JSON.stringify(saved));
}

export function deleteNamed(storage: StorageLike, name: string) {
  const saved = loadSaved(storage);
  delete saved[name];
  storage.setItem(SAVED_KEY, JSON.stringify(saved));
}
