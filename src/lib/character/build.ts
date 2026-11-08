import type { ItemRecord, PaletteColor } from '../types.js';
import type { OutfitSnapshot } from '../stores/outfits.js';
import { CharacterRig } from './rig.js';
import { paletteToTint } from './tint.js';

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

/** A character ready to place in a scene, wearing a saved outfit. Items that no longer exist are skipped. */
export async function buildRig(snap: OutfitSnapshot): Promise<CharacterRig> {
  const skins = await getPalette(SKIN_PALETTE);
  const skin = skins[snap.skin];
  const rig = await CharacterRig.create(snap.gender, skin ? paletteToTint(skin) : undefined);

  const records = await Promise.all(
    snap.items.map((entry) =>
      fetch(`/api/items/${entry.id}`)
        .then((r) => (r.ok ? (r.json() as Promise<ItemRecord>) : null))
        .catch(() => null)
    )
  );
  for (let i = 0; i < records.length; i++) {
    const item = records[i];
    if (!item) continue;
    const colors = item.palette ? await getPalette(item.palette) : [];
    const chosen = colors[snap.items[i].color ?? item.defaultColor] ?? colors[0];
    await rig.equip(item, chosen ? paletteToTint(chosen) : undefined).catch(() => undefined);
  }
  return rig;
}
