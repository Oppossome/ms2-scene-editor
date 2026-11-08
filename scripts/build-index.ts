/**
 * Builds the JSON indexes the app queries (items, npcs, maps, palettes, flat models) from the extracted game data.
 * Output: .data/*.json (or $MS2_DATA)   Run with: npm run index
 */
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type {
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
const num = (v: unknown, fallback = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));
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
  for (const k of doc?.ms2?.key ?? []) out.set(String(k.id), { name: String(k.name ?? ''), cls: String(k.class ?? '') });
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
    const envs: Record<string, any>[] = doc?.ms2?.environment ?? [];
    const assets: ItemAsset[] = [];
    const seen = new Set<string>();
    let property: Record<string, string> | undefined;
    let palette = 0;
    let defaultColor = 0;
    let channels: [boolean, boolean] = [false, false];
    for (const env of envs) {
      property ??= env.property;
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
      category: String(property?.category ?? '')
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
    npcs.push({
      id,
      name: names.get(id)?.name ?? kfm,
      glb,
      scale: num(model[2], 1),
      level: num(/<basic[^>]*\blevel="(\d+)"/.exec(text)?.[1])
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

write('palettes.json', palettes);
write('items.json', items);
write('npcs.json', npcs);
write('maps.json', maps);
write('flats.json', flats);
write('llids.json', llids);
const meta: IndexMeta = {
  builtAt: new Date().toISOString(),
  items: items.length,
  npcs: npcs.length,
  maps: maps.length,
  flatModels: Object.keys(flats).length,
  llidModels: Object.keys(llids).length,
  palettes: Object.keys(palettes).length,
  warnings
};
write('meta.json', meta);
console.log(meta);
