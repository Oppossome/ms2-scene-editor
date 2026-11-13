import type { Gender, ItemAsset, ItemRecord } from '../../types.js';

export const SLOT_LABELS: Record<string, string> = {
  HR: 'Hair',
  FA: 'Face',
  FH: 'Forehead',
  EY: 'Eyes',
  EA: 'Earrings',
  CP: 'Hat',
  CL: 'Top',
  PA: 'Pants',
  GL: 'Gloves',
  SH: 'Shoes',
  MT: 'Cape',
  BE: 'Belt',
  RH: 'Right hand',
  LH: 'Left hand',
  OH: 'Both hands'
};

/** Display order of the item slots. */
export const SLOT_ORDER = ['HR', 'FA', 'FH', 'EY', 'EA', 'CP', 'CL', 'PA', 'GL', 'SH', 'MT', 'BE', 'RH', 'LH', 'OH'];

export const slotLabel = (slot: string) => SLOT_LABELS[slot] ?? slot;

/** Names of body meshes that belong to a slot: the slot itself or `<slot>_<part>` (CL_Skin, PA_Panty...). */
export function bodyMeshesForSlot(slot: string, meshNames: string[]): string[] {
  const prefix = slot.toLowerCase();
  return meshNames.filter((name) => {
    const n = name.toLowerCase();
    return n === prefix || n.startsWith(prefix + '_');
  });
}

/**
 * Assets of an item that apply to a gender, one group per slot:
 * assets made for that gender win, otherwise the unisex (2) ones are used.
 */
export function pickAssets(item: Pick<ItemRecord, 'assets'>, gender: Exclude<Gender, 2>): ItemAsset[] {
  const bySlot = new Map<string, ItemAsset[]>();
  for (const a of item.assets) {
    if (a.gender !== gender && a.gender !== 2) continue;
    const list = bySlot.get(a.slot) ?? [];
    list.push(a);
    bySlot.set(a.slot, list);
  }
  const out: ItemAsset[] = [];
  for (const list of bySlot.values()) {
    const exact = list.filter((a) => a.gender === gender);
    out.push(...(exact.length ? exact : list));
  }
  return out;
}
