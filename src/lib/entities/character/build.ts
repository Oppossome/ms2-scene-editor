import type { ItemRecord, PaletteColor } from '../../types.js';
import { paletteToTint, tintFromPalette, type ChannelIndexes, type TintColors } from './tint.js';

import { SKIN_PALETTE, EYE_PALETTE } from './appearance.js';

const paletteCache = new Map<number, Promise<PaletteColor[]>>();

export function getPalette(id: number): Promise<PaletteColor[]> {
  let hit = paletteCache.get(id);
  if (!hit) {
    hit = fetch(`/api/palettes/${id}`).then((r) => (r.ok ? (r.json() as Promise<PaletteColor[]>) : []));
    paletteCache.set(id, hit);
  }
  return hit;
}

async function paletteTint(palette: number, index: number): Promise<TintColors | undefined> {
  const chosen = (await getPalette(palette))[index];
  return chosen ? paletteToTint(chosen) : undefined;
}

/** Tint of a skin tone (palette index), or undefined when the palette has no such colour. */
export const skinTint = (index: number) => paletteTint(SKIN_PALETTE, index);

/** Tint of an eye colour (palette index): the iris regions of the face use it. */
export const eyeTint = (index: number) => paletteTint(EYE_PALETTE, index);

/**
 * Tint of an item for a chosen palette row (its default when none is given), with optional per-channel picks;
 * undefined when the item is not customisable.
 */
export async function itemTint(item: ItemRecord, index?: number, picks?: ChannelIndexes | null): Promise<TintColors | undefined> {
  if (!item.palette) return undefined;
  const colors = await getPalette(item.palette);
  return tintFromPalette(colors, index ?? item.defaultColor, picks);
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
