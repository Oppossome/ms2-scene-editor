import type { ItemRecord, PaletteColor } from '../types.js';
import { paletteToTint, type TintColors } from './tint.js';

/** The body's skin tones live in palette 1. */
export const SKIN_PALETTE = 1;

const paletteCache = new Map<number, Promise<PaletteColor[]>>();

export function getPalette(id: number): Promise<PaletteColor[]> {
  let hit = paletteCache.get(id);
  if (!hit) {
    hit = fetch(`/api/palettes/${id}`).then((r) => (r.ok ? (r.json() as Promise<PaletteColor[]>) : []));
    paletteCache.set(id, hit);
  }
  return hit;
}

/** Tint of a skin tone (palette index), or undefined when the palette has no such colour. */
export async function skinTint(index: number): Promise<TintColors | undefined> {
  const colors = await getPalette(SKIN_PALETTE);
  const chosen = colors[index];
  return chosen ? paletteToTint(chosen) : undefined;
}

/** Tint of an item for a chosen palette colour (its default when none is given); undefined when not customisable. */
export async function itemTint(item: ItemRecord, index?: number): Promise<TintColors | undefined> {
  if (!item.palette) return undefined;
  const colors = await getPalette(item.palette);
  const chosen = colors[index ?? item.defaultColor] ?? colors[0];
  return chosen ? paletteToTint(chosen) : undefined;
}

const itemCache = new Map<string, Promise<ItemRecord | null>>();

/** An item record by id (cached); null when the item no longer exists. */
export function getItem(id: string): Promise<ItemRecord | null> {
  let hit = itemCache.get(id);
  if (!hit) {
    hit = fetch(`/api/items/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<ItemRecord>) : null))
      .catch(() => null);
    itemCache.set(id, hit);
  }
  return hit;
}
