import { z } from 'zod';
import { issueText, outfitSchema } from '../scene/schemas.js';

/**
 * Saved outfits (localStorage): a reusable look (gender, skin, eyes, face, worn items), not scene state. A character
 * makes one with `captureOutfit`; the shape is the `outfitSchema` that validates it when loaded.
 */

export type OutfitSnapshot = z.infer<typeof outfitSchema>;

export const SAVED_KEY = 'ms2se.outfit.saved';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Validate untrusted JSON into a snapshot; returns null when it is not usable. */
export function parseSnapshot(data: unknown, issues: string[] = []): OutfitSnapshot | null {
  const result = outfitSchema.safeParse(data);
  if (!result.success) issues.push(issueText(result.error));
  return result.success ? result.data : null;
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
    const result = z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw));
    if (!result.success) {
      console.warn(`Cannot read saved outfits: ${issueText(result.error)}`);
      return {};
    }
    const out: Record<string, OutfitSnapshot> = {};
    for (const [name, value] of Object.entries(result.data)) {
      const issues: string[] = [];
      const snap = parseSnapshot(value, issues);
      if (snap) out[name] = snap;
      else console.warn(`Skipping invalid outfit "${name}": ${issues.join('; ')}`);
    }
    return out;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.warn(`Cannot read saved outfits: ${error.message}`);
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
