import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { EffectDummy, EffectTimeline, EffectTimelineEntry, EffectTimelineNif } from '../types.js';
import { EXTRACTED_ROOT, resolveAssetPath } from './assets.js';
import { getEffects } from './index-data.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'effect' || name === 'dummy'
});

type Attrs = Record<string, string | undefined>;
/** An <effect> element: its attributes, nested random options and child elements (read with `child`). */
type EffectNode = Attrs & { effect?: EffectNode[] };

const vec3 = (text: string | undefined, fallback: [number, number, number]): [number, number, number] => {
  const parts = (text ?? '').split(',').map((p) => Number(p.trim()));
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as [number, number, number]) : fallback;
};
const num = (text: string | undefined, fallback: number) => {
  const n = Number(text);
  return text !== undefined && text.trim() !== '' && Number.isFinite(n) ? n : fallback;
};
const bool = (text: string | undefined, fallback: boolean) =>
  text === undefined ? fallback : text.trim().toLowerCase() === 'true';
const child = (node: unknown, name: string): Attrs => {
  // Element names vary in case in the game files (applyNodeTransform, applyNodetransform).
  const record = node as Record<string, unknown>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? record[key] : undefined;
  return (Array.isArray(value) ? value[0] : value) ?? {};
};

/** Lowercase NIF path relative to Model/Effect (backslashes, no extension) -> converted model. */
export type GlbResolver = (file: string) => string | null;

function parseEntry(node: EffectNode, resolve: GlbResolver): EffectTimelineEntry | null {
  if (node.type === 'random') {
    const options = ((node.effect as EffectNode[] | undefined) ?? []).flatMap((e) => parseEntry(e, resolve) ?? []);
    if (!options.length) return null;
    const weights = (node.prob ?? '')
      .split(',')
      .map((w) => Number(w.trim()))
      .filter((w) => Number.isFinite(w) && w >= 0);
    return { kind: 'random', weights: options.map((_, i) => weights[i] ?? 1), options };
  }
  if (node.type !== 'nif' || !node.filePath) return null;
  const attach = child(node, 'attachInfo');
  const transform = child(node, 'transform');
  const duration = num(node.duration, NaN);
  const nif: EffectTimelineNif = {
    kind: 'nif',
    file: node.filePath.replace(/\\/g, '/'),
    glb: resolve(node.filePath),
    startDelay: Math.max(0, num(node.startDelay, 0)),
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    loop: bool(node.loop, false),
    parentNode: (attach.parentNode ?? '').trim() || 'Scene Root',
    attachToNode: bool(attach.attachToNode, true),
    applyNodeTransform: bool(attach.applyNodeTransform, true),
    translate: vec3(transform.translate, [0, 0, 0]),
    rotation: vec3(transform.rotation, [0, 0, 0]),
    scale: num(transform.scale, 1)
  };
  return nif;
}

/**
 * The NIFs of an effect XML, in order, with `random` groups kept as choices. Other entry types (sounds, camera shake,
 * screen tints, weapon trails, lights) are left out: the studio does not play them.
 */
export function parseEffectXml(xml: string, resolve: GlbResolver): EffectTimelineEntry[] {
  const doc = parser.parse(xml.replace(/^\uFEFF/, '')) as { ms2?: { effect?: EffectNode[] } };
  return (doc.ms2?.effect ?? []).flatMap((e) => parseEntry(e, resolve) ?? []);
}

/** Effect dummies (pceffectdummy.xml for players, an NPC's <effectdummy>, defaulteffectdummy.xml). */
export function parseDummies(xml: string, gender?: 0 | 1): EffectDummy[] {
  const doc = parser.parse(xml.replace(/^\uFEFF/, '')) as {
    ms2?: { dummy?: Attrs[]; effectdummy?: { dummy?: Attrs[] } };
  };
  const nodes = [...(doc.ms2?.dummy ?? []), ...(doc.ms2?.effectdummy?.dummy ?? [])];
  const out = new Map<string, EffectDummy>();
  for (const node of nodes) {
    if (!node.name) continue;
    if (gender !== undefined && node.gender !== undefined && Number(node.gender) !== gender) continue;
    const attach = child(node, 'attachInfo');
    const transform = child(node, 'transform');
    out.set(node.name, {
      name: node.name,
      parentNode: (attach.parentNode ?? '').trim() || 'Scene Root',
      translate: vec3(transform.translate, [0, 0, 0]),
      rotation: vec3(transform.rotation, [0, 0, 0]),
      scale: num(transform.scale, 1),
      world: bool(attach.applyWorldTransform, false)
    });
  }
  return [...out.values()];
}

let effectGlbs: { source: unknown; map: Map<string, string> } | null = null;

/** Converted model for a NIF path from an effect XML (relative to Model/Effect, any case or separators). */
export function effectGlb(file: string): string | null {
  const records = getEffects();
  if (!effectGlbs || effectGlbs.source !== records)
    effectGlbs = { source: records, map: new Map(records.map((r) => [r.id, r.glb])) };
  const id = file
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(model\/)?effect\//i, '')
    .replace(/\.nif$/i, '')
    .toLowerCase();
  return effectGlbs.map.get(id) ?? null;
}

const timelines = new Map<string, EffectTimeline | null>();

/** An effect XML by its path relative to Xml/effect (as items, NPCs and skills name them), or null. */
export function loadEffectTimeline(rel: string): EffectTimeline | null {
  const key = rel.replace(/\\/g, '/').toLowerCase();
  if (timelines.has(key)) return timelines.get(key)!;
  const file = resolveAssetPath(`Xml/effect/${key}`, EXTRACTED_ROOT, ['xml/effect']);
  const timeline = file ? { path: rel, entries: parseEffectXml(fs.readFileSync(file, 'utf8'), effectGlb) } : null;
  timelines.set(key, timeline);
  return timeline;
}

const dummyCache = new Map<string, EffectDummy[]>();

/** Player effect dummies for a gender (pceffectdummy.xml), falling back to the defaults. */
export function loadPlayerDummies(gender: 0 | 1): EffectDummy[] {
  const key = `pc${gender}`;
  const hit = dummyCache.get(key);
  if (hit) return hit;
  const file =
    resolveAssetPath('Xml/table/pceffectdummy.xml', EXTRACTED_ROOT, ['xml/table']) ??
    resolveAssetPath('Xml/table/defaulteffectdummy.xml', EXTRACTED_ROOT, ['xml/table']);
  const dummies = file ? parseDummies(fs.readFileSync(file, 'utf8'), gender) : [];
  dummyCache.set(key, dummies);
  return dummies;
}
