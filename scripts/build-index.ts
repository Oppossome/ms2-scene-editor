/**
 * Builds the JSON indexes the app queries (items, npcs, maps, palettes, flat models) from the extracted game data.
 * Output: .data/*.json (or $MS2_DATA)   Run with: npm run index
 */
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type {
  EffectRecord,
  EffectTimelineNif,
  EmoteMotion,
  EmoteRecord,
  Gender,
  IndexMeta,
  ItemAsset,
  ItemRecord,
  MapRecord,
  NpcRecord,
  PaletteColor
} from '../src/lib/types.ts';

const ROOT = path.resolve(process.env.MS2_EXTRACTED ?? 'extracted');
const OUT = path.resolve(process.env.MS2_DATA ?? '.data');
const warnings: Record<string, number> = {};
const warn = (key: string) => (warnings[key] = (warnings[key] ?? 0) + 1);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  isArray: (name) => ['environment', 'slot', 'asset', 'colorPalette', 'color', 'key'].includes(name)
});

function* walk(dir: string, ext: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, ext);
    else if (e.name.toLowerCase().endsWith(ext)) yield full;
  }
}

const readText = (file: string) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const num = (v: unknown, fallback = 0) =>
  v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
const flag = (v: unknown) => v === '1' || v === 1 || v === 'true' || v === true;

// ---- converted model lookup (lowercase relative path -> actual relative path)
console.log('scanning converted models...');
const modelsRoot = path.join(ROOT, 'converted/models');
const glbIndex = new Map<string, string>();
for (const file of walk(modelsRoot, '.glb')) {
  const rel = path.relative(modelsRoot, file).split(path.sep).join('/');
  glbIndex.set(rel.toLowerCase(), rel);
}
console.log(`  ${glbIndex.size} models`);

function glbFor(relNoExt: string): string | null {
  return glbIndex.get((relNoExt.replace(/\\/g, '/') + '.glb').toLowerCase()) ?? null;
}

// ---- string tables
function readNames(file: string): Map<string, { name: string; cls: string }> {
  const out = new Map<string, { name: string; cls: string }>();
  const full = path.join(ROOT, 'Xml/string/en', file);
  if (!fs.existsSync(full)) return out;
  const doc = parser.parse(readText(full));
  for (const k of doc?.ms2?.key ?? [])
    out.set(String(k.id), { name: String(k.name ?? ''), cls: String(k.class ?? '') });
  return out;
}

// ---- colour palettes
function buildPalettes(): Record<string, PaletteColor[]> {
  const doc = parser.parse(readText(path.join(ROOT, 'Xml/table/colorpalette.xml')));
  const out: Record<string, PaletteColor[]> = {};
  for (const p of doc?.ms2?.colorPalette ?? []) {
    out[String(p.id)] = (p.color ?? []).map((c: Record<string, string>) => ({
      sn: num(c.colorSN),
      ch0: c.ch0,
      ch1: c.ch1,
      ch2: c.ch2,
      palette: c.palette
    }));
  }
  return out;
}

// ---- items
const iconDir = path.join(ROOT, 'Resource/Image/item/icon');
const iconFiles = new Set(fs.existsSync(iconDir) ? fs.readdirSync(iconDir).map((f) => f.toLowerCase()) : []);

function itemIcon(property: Record<string, string> | undefined, id: string): string {
  if (iconFiles.has(`${id}.png`)) return `Resource/Image/item/icon/${id}.png`;
  for (const candidate of [property?.slotIcon, property?.slotIconCustom]) {
    if (candidate && /^\.?\/?Data\//i.test(candidate)) return candidate.replace(/^\.?\/?Data\//i, '');
  }
  return `Resource/Image/item/icon/${id}.png`;
}

interface ItemEnvironment {
  property?: Record<string, string>;
  effect?: Record<string, string>;
  customize?: Record<string, string>;
  slots?: { slot?: { name?: string; asset?: Record<string, string>[] }[] };
}

function buildItems(): ItemRecord[] {
  const names = readNames('itemname.xml');
  const items: ItemRecord[] = [];
  const itemsRoot = path.join(ROOT, 'Xml/item');
  let n = 0;
  for (const file of walk(itemsRoot, '.xml')) {
    if (++n % 5000 === 0) console.log(`  items ${n}`);
    const id = path.basename(file, '.xml');
    let doc;
    try {
      doc = parser.parse(readText(file));
    } catch {
      warn('item xml parse error');
      continue;
    }
    const envs: ItemEnvironment[] = doc?.ms2?.environment ?? [];
    const assets: ItemAsset[] = [];
    const seen = new Set<string>();
    let property: Record<string, string> | undefined;
    let palette = 0;
    let defaultColor = 0;
    let channels: [boolean, boolean] = [false, false];
    const effects: NonNullable<ItemRecord['effects']> = {};
    for (const env of envs) {
      property ??= env.property;
      for (const key of ['idle', 'battleIdle', 'characterIdle', 'characterBattleIdle'] as const) {
        const value = String(env.effect?.[key] ?? '').trim();
        if (!effects[key] && /\.xml$/i.test(value)) effects[key] = value.replace(/\\/g, '/');
      }
      if (!palette) {
        palette = num(env.customize?.colorPalette);
        defaultColor = Math.max(0, num(env.customize?.defaultColorIndex, 0));
        channels = [num(env.customize?.ch0) === 1, num(env.customize?.ch2) === 1];
      }
      for (const slot of env.slots?.slot ?? []) {
        for (const a of slot.asset ?? []) {
          const m = /^(?:\.?\/)?Data\/Resource\/Model\/(.+)\.nif$/i.exec(String(a.name ?? ''));
          if (!m) continue;
          const glb = glbFor(m[1]);
          if (!glb) {
            warn('item asset without converted model');
            continue;
          }
          const key = `${slot.name}|${glb}|${a.gender}`;
          if (seen.has(key)) continue;
          seen.add(key);
          assets.push({
            slot: String(slot.name ?? ''),
            glb,
            gender: num(a.gender, 2) as Gender,
            selfnode: String(a.selfnode ?? ''),
            targetnode: String(a.targetnode ?? ''),
            attachnode: String(a.attachnode ?? ''),
            replace: flag(a.replace),
            earfold: flag(a.earfold),
            weapon: flag(a.weapon)
          });
        }
      }
    }
    if (assets.length === 0) continue;
    const label = names.get(id);
    if (!label) warn('item without name');
    items.push({
      id,
      name: label?.name || id,
      cls: label?.cls ?? '',
      icon: itemIcon(property, id),
      slots: [...new Set(assets.map((a) => a.slot))],
      assets,
      palette,
      defaultColor,
      channels,
      type: num(property?.type),
      subtype: num(property?.subtype),
      category: String(property?.category ?? ''),
      ...(Object.keys(effects).length ? { effects } : {})
    });
  }
  return items;
}

// ---- npcs
function buildNpcs(): NpcRecord[] {
  const names = readNames('npcname.xml');
  const npcs: NpcRecord[] = [];
  for (const file of walk(path.join(ROOT, 'Xml/npc'), '.xml')) {
    const text = readText(file);
    const model = /<model\s+kfm="([^"]+)"(?:[^>]*?\bscale="([^"]*)")?/.exec(text);
    if (!model) continue;
    const kfm = model[1];
    const prefix = /^\d+/.exec(kfm)?.[0] ?? '';
    const glb = glbFor(`Npc/${prefix.slice(0, 2)}/${prefix}/${kfm}`);
    if (!glb) {
      warn('npc without converted model');
      continue;
    }
    const id = path.basename(file, '.xml');
    const keepEffect = /<basic[^>]*\bkeepEffect="([^"]+\.xml)"/i.exec(text)?.[1]?.replace(/\\/g, '/');
    npcs.push({
      id,
      name: names.get(id)?.name ?? kfm,
      glb,
      scale: num(model[2], 1),
      level: num(/<basic[^>]*\blevel="(\d+)"/.exec(text)?.[1]),
      ...(keepEffect ? { keepEffect } : {})
    });
  }
  return npcs;
}

// ---- maps
function buildMaps(): MapRecord[] {
  const names = readNames('mapname.xml');
  const xblockDir = path.join(ROOT, 'Resource/Exported/xblock');
  const available = new Set(fs.readdirSync(xblockDir).map((f) => f.toLowerCase()));
  const maps: MapRecord[] = [];
  for (const file of walk(path.join(ROOT, 'Xml/map'), '.xml')) {
    const xblock = /<xblock\s+name="([^"]+)"/.exec(readText(file))?.[1]?.toLowerCase();
    if (!xblock) continue;
    if (!available.has(xblock + '.xblock')) {
      warn('map without xblock file');
      continue;
    }
    const id = path.basename(file, '.xml');
    maps.push({ id, name: names.get(id)?.name ?? xblock, xblock });
  }
  return maps;
}

// ---- flat models: modelName -> converted model, via the llid/relpath asset metadata
function buildFlatModels(): { flats: Record<string, string>; llids: Record<string, string> } {
  const metaDir = path.join(ROOT, 'Resource/asset-web-metadata');
  const subjectLine = /^<urn:uuid:([0-9a-f-]+)> <[^>]+> "(.*)"\.$/;
  const llidToUuid = new Map<string, string>();
  for (const line of readText(path.join(metaDir, 'llid.nt')).split('\n')) {
    const m = subjectLine.exec(line);
    if (m) llidToUuid.set(m[2], m[1]);
  }
  const uuidToRel = new Map<string, string>();
  for (const line of readText(path.join(metaDir, 'relpath.nt')).split('\n')) {
    const m = subjectLine.exec(line);
    if (m) uuidToRel.set(m[1], m[2]);
  }
  // llid -> converted model for every asset that has one (entities can override their flat's model by llid).
  const llids: Record<string, string> = {};
  for (const [llid, uuid] of llidToUuid) {
    const rel = uuidToRel.get(uuid);
    if (!rel || !/\.nif$/i.test(rel)) continue;
    const glb = glbFor(rel.replace(/^\/?Model\//i, '').replace(/\.nif$/i, ''));
    if (glb) llids[llid.toLowerCase()] = glb;
  }

  const out: Record<string, string> = {};
  let n = 0;
  for (const file of walk(path.join(ROOT, 'Resource/Exported/flat'), '.flat')) {
    if (++n % 4000 === 0) console.log(`  flats ${n}`);
    const text = readText(file);
    const name = /<model\s+name="([^"]+)"/.exec(text)?.[1];
    const llid = /name="NifAsset"[^>]*>\s*<set value="urn:llid:([0-9a-fA-F-]+)"/.exec(text)?.[1];
    if (!name || !llid) {
      warn('flat without NifAsset');
      continue;
    }
    const rel = uuidToRel.get(llidToUuid.get(llid) ?? '');
    if (!rel) {
      warn('flat llid not in metadata');
      continue;
    }
    const glb = glbFor(rel.replace(/^\/?Model\//i, '').replace(/\.nif$/i, ''));
    if (!glb) {
      warn('flat model not converted');
      continue;
    }
    out[name.toLowerCase()] = glb;
  }
  return { flats: out, llids };
}

// ---- emotes: the clips and effect XMLs of each skill's first level (skills that show an effect, and the emote skills)
function buildEmotes(): EmoteRecord[] {
  const names = new Map<string, string>();
  const stringDir = path.join(ROOT, 'Xml/string/en');
  for (const file of fs.existsSync(stringDir) ? fs.readdirSync(stringDir) : [])
    if (/^skillname.*\.xml$/i.test(file)) for (const [id, v] of readNames(file)) if (v.name) names.set(id, v.name);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]?.trim() ?? '';
  const out: EmoteRecord[] = [];
  for (const file of walk(path.join(ROOT, 'Xml/skill'), '.xml')) {
    const text = readText(file);
    const level = /<level\b[^>]*>([\s\S]*?)<\/level>/.exec(text)?.[1] ?? '';
    const motions: EmoteMotion[] = [];
    for (const tag of level.match(/<motionProperty\b[^>]*>/g) ?? []) {
      const clip = attr(tag, 'sequenceName');
      if (!clip) continue;
      const cast = attr(tag, 'motionEffect').replace(/\\/g, '/');
      const loop = attr(tag, 'loopEffect').replace(/\\/g, '/');
      motions.push({ clip, ...(cast ? { cast } : {}), ...(loop ? { loop } : {}) });
    }
    const id = path.basename(file, '.xml');
    if (!motions.some((m) => m.cast || m.loop)) {
      // Emotes name their clip in <kinds emotion=...> instead (and keep effects in a table of their own).
      const kinds = /<kinds\b[^>]*>/.exec(text)?.[0] ?? '';
      const emote = emoteMotions(attr(kinds, 'emotionType'), attr(kinds, 'emotion'), emoteEffects.get(id));
      if (!emote.length) continue;
      motions.splice(0, motions.length, ...emote);
    }
    out.push({ id, name: names.get(id) ?? id, motions });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---- emotes: clips by name (emotionType 1) or a couple emote (2, Xml/table/coupleemotion.xml), plus their effects
const bodyClips = new Set<string>();
for (const rel of glbIndex.keys()) {
  const m = /^character\/(?:male\/m_body|female\/f_body)\.anims\/([^/]+)\.glb$/.exec(rel);
  if (m) bodyClips.add(m[1]);
}

/** Effect XML by emote skill id (`gosEmotion`, else `gosEmotionIdle`; the effect for both genders when there is one). */
const emoteEffects = new Map<string, string>();
{
  const file = path.join(ROOT, 'Xml/table/stateeffectpc.xml');
  const text = fs.existsSync(file) ? readText(file) : '';
  const found: { id: string; effect: string; rank: number }[] = [];
  for (const [, type, effect, body] of text.matchAll(
    /<StateEffect\b[^>]*stateType="([^"]*)"[^>]*effect="([^"]*)"[^>]*>([\s\S]*?)<\/StateEffect>/g
  )) {
    const id = /emotionSkillID="(\d+)"/.exec(body)?.[1];
    const gender = /gender="(\d)"/.exec(body)?.[1] ?? '2';
    if (id && effect) found.push({ id, effect, rank: (type === 'gosEmotion' ? 0 : 2) + (gender === '2' ? 0 : 1) });
  }
  for (const f of found.sort((a, b) => a.rank - b.rank))
    if (!emoteEffects.has(f.id)) emoteEffects.set(f.id, f.effect.replace(/\\/g, '/'));
}

/** Couple emotes by code: every clip either partner plays, ready then loop (a model plays the ones of its gender). */
const coupleClips = new Map<string, string[]>();
{
  const file = path.join(ROOT, 'Xml/table/coupleemotion.xml');
  for (const tag of (fs.existsSync(file) ? readText(file) : '').match(/<coupleEmotion\b[^>]*>/g) ?? []) {
    const code = /\bcode="(\d+)"/.exec(tag)?.[1];
    if (!code) continue;
    const clips = [...tag.matchAll(/animation\w+_(?:male|female|requestUser|targetUser)="([^"]*)"/g)]
      .flatMap(([, list]) => list.split(','))
      .map((c) => c.trim())
      .filter((c) => c && bodyClips.has(c.toLowerCase()));
    coupleClips.set(code, [...new Set(clips)]);
  }
}

function emoteMotions(type: string, emotion: string, effect: string | undefined): EmoteMotion[] {
  const fx = effect ? { cast: effect } : {};
  if (type === '2') return (coupleClips.get(emotion) ?? []).map((clip) => ({ clip, ...fx }));
  if (type !== '1' || !emotion) return [];
  const e = emotion.toLowerCase();
  const main = [`emotion_${e}`, `emotion_${e}_a`, e, `emotion_sit_${e}`].find((c) => bodyClips.has(c));
  if (!main) return effect ? [{ clip: `Emotion_${emotion}`, ...fx }] : [];
  // Its other parts: the ready/loop/idle clips that share its name (not other lettered emotes: Dance_A vs Dance_C).
  const base = main.replace(/(_(ready|loop|idle|down|talk|bore)(_[a-z]\d*)?)+$/, '').replace(/_a$/, '');
  const part = /^(ready|loop|idle|down|talk|bore)(_|$)|_(ready|loop|idle|down|talk|bore)(_|$)/;
  const related = [...bodyClips]
    .filter((c) => c !== main && c.startsWith(`${base}_`) && part.test(c.slice(base.length + 1)))
    .sort();
  return [main, ...related].map((clip) => ({ clip, ...fx }));
}

// ---- instruments: playing one is an emote whose props are the instrument (Xml/table/instrumentinfo.xml)
function buildInstruments(): EmoteRecord[] {
  const file = path.join(ROOT, 'Xml/table/instrumentinfo.xml');
  if (!fs.existsSync(file)) return [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]?.trim() ?? '';
  const itemNames = readNames('itemname.xml');
  const itemXml = (id: string) => {
    const full = path.join(ROOT, 'Xml/item', id[0] ?? '', id.slice(1, 3), `${id}.xml`);
    return fs.existsSync(full) ? readText(full) : '';
  };

  // The item a player plays it with names it best (`OpenInstrument` with the instrument id).
  const playedBy = new Map<string, string>();
  const itemDir = path.join(ROOT, 'Xml/item/3');
  for (const xml of fs.existsSync(itemDir) ? walk(itemDir, '.xml') : []) {
    const id = /OpenInstrument" parameter="(\d+)"/.exec(readText(xml))?.[1];
    const name = itemNames.get(path.basename(xml, '.xml'))?.name;
    if (id && name && !playedBy.has(id)) playedBy.set(id, name);
  }

  // Instrument models are effect NIFs; a .kfm stand is converted under a folder of its own, so fall back to the name.
  const byBase = new Map<string, string>();
  for (const rel of glbIndex.values())
    if (/^effect\//i.test(rel)) byBase.set(path.posix.basename(rel, '.glb').toLowerCase(), rel);
  const prop = (asset: string, parentNode: string): EffectTimelineNif | null => {
    const nif = asset.replace(/\\/g, '/').replace(/^.*?model\/effect\//i, '');
    const stem = nif.replace(/\.(nif|kfm)$/i, '');
    const glb = glbFor(`Effect/${stem}`) ?? byBase.get(path.posix.basename(stem).toLowerCase()) ?? null;
    if (!glb) return (warn('instrument model not converted'), null);
    return {
      kind: 'nif',
      file: `${stem}.nif`,
      glb,
      startDelay: 0,
      duration: null,
      loop: true,
      parentNode,
      attachToNode: true,
      applyNodeTransform: true,
      translate: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1
    };
  };

  const out: EmoteRecord[] = [];
  for (const tag of readText(file).match(/<instrument\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'id');
    const props: EffectTimelineNif[] = [];
    const stand = attr(tag, 'asset');
    if (stand) props.push(...[prop(stand, 'Scene Root')].filter((p) => !!p));
    const item = attr(tag, 'equipItemId');
    for (const [, asset, node] of itemXml(item).matchAll(/<asset name="([^"]+)"[^>]*?targetnode="([^"]*)"/g)) {
      const held = prop(asset, node || 'Weapon_Hand_R_Point');
      if (held && !props.some((p) => p.glb === held.glb && p.parentNode === held.parentNode)) props.push(held);
    }
    const effect = attr(tag, 'playEffect').replace(/\\/g, '/');
    const motions: EmoteMotion[] = [1, 2, 3, 4]
      .map((n) => attr(tag, `animationPlayLevel${n}`))
      .filter(Boolean)
      .map((clip) => ({ clip, ...(effect ? { cast: effect } : {}) }));
    for (const key of ['animationPlayIdle', 'animationReady']) {
      const clip = attr(tag, key);
      if (clip) motions.push({ clip });
    }
    if (!motions.length) continue;
    const name = playedBy.get(id) ?? itemNames.get(item)?.name.replace(/\s*\(Dummy\)$/i, '') ?? `Instrument ${id}`;
    out.push({ id: `instrument-${id}`, name, motions, ...(props.length ? { props } : {}) });
  }
  return out;
}

// ---- effects: every converted effect model
function buildEffects(): EffectRecord[] {
  const out: EffectRecord[] = [];
  for (const rel of glbIndex.values()) {
    if (!/^effect\//i.test(rel) || /\.anims\/|\/_clips\//i.test(rel)) continue;
    const name = rel.replace(/^effect\//i, '').replace(/\.glb$/i, '');
    out.push({ id: name.toLowerCase(), name, glb: rel });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function write(name: string, data: unknown) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));
}

fs.mkdirSync(OUT, { recursive: true });
console.log('palettes...');
const palettes = buildPalettes();
console.log('items...');
const items = buildItems();
console.log('npcs...');
const npcs = buildNpcs();
console.log('maps...');
const maps = buildMaps();
console.log('flat models...');
const { flats, llids } = buildFlatModels();
console.log('effects...');
const effects = buildEffects();
console.log('emotes...');
const emotes = [...buildEmotes(), ...buildInstruments()];

write('palettes.json', palettes);
write('items.json', items);
write('npcs.json', npcs);
write('maps.json', maps);
write('flats.json', flats);
write('llids.json', llids);
write('effects.json', effects);
write('emotes.json', emotes);
const meta: IndexMeta = {
  builtAt: new Date().toISOString(),
  items: items.length,
  npcs: npcs.length,
  maps: maps.length,
  flatModels: Object.keys(flats).length,
  llidModels: Object.keys(llids).length,
  effects: effects.length,
  emotes: emotes.length,
  palettes: Object.keys(palettes).length,
  warnings
};
write('meta.json', meta);
console.log(meta);
