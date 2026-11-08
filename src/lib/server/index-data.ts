import fs from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { IndexMeta, ItemRecord, MapRecord, NpcRecord, PaletteColor } from '../types.js';

const DATA_DIR = path.resolve(process.env.MS2_DATA ?? '.data');

/** A file inside the data folder (for derived caches written at run time). */
export const dataFile = (name: string) => path.join(DATA_DIR, name);

interface Cached<T> {
  mtimeMs: number;
  value: T;
}
const cache = new Map<string, Cached<unknown>>();

/** Load a JSON index, reloading when the file changes on disk. */
function load<T>(name: string): T {
  const file = path.join(DATA_DIR, name);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    error(503, `Index file ${name} is missing. Run "npm run index" first.`);
  }
  const hit = cache.get(name);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value as T;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  cache.set(name, { mtimeMs: stat.mtimeMs, value });
  return value;
}

export const getItems = () => load<ItemRecord[]>('items.json');
export const getNpcs = () => load<NpcRecord[]>('npcs.json');
export const getMaps = () => load<MapRecord[]>('maps.json');
export const getPalettes = () => load<Record<string, PaletteColor[]>>('palettes.json');
/** Lowercase flat model name -> converted model path (relative to converted/models). */
export const getFlats = () => load<Record<string, string>>('flats.json');
/** Lowercase llid -> converted model path. */
export const getLlids = () => load<Record<string, string>>('llids.json');
export const getMeta = () => load<IndexMeta>('meta.json');

let itemsById: { source: ItemRecord[]; map: Map<string, ItemRecord> } | null = null;
export function getItemById(id: string): ItemRecord | undefined {
  const items = getItems();
  if (!itemsById || itemsById.source !== items) itemsById = { source: items, map: new Map(items.map((i) => [i.id, i])) };
  return itemsById.map.get(id);
}
