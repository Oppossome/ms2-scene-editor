import fs from 'node:fs';
import type { MapEnvironment } from '../types.js';
import { EXTRACTED_ROOT, resolveAssetPath } from './assets.js';

/** Where the converted backdrop images live, relative to `converted/textures`. */
const BACKDROP_DIR = 'Resource/Image/bg';

/** Attributes of the first `<tag .../>` in an XML text (the map settings files are flat and well formed). */
function attributes(xml: string, tag: string): Record<string, string> | null {
  const match = new RegExp(`<${tag}\\s([^>]*)>`).exec(xml);
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g)) out[name] = value;
  return out;
}

/**
 * The environment a map's settings file (\`Xml/mapxblock/<xblock>.xml\`) describes: \`<clientProperty bgDay="BG_Tria.dds"/>\`
 * names the backdrop (a .dds file in Resource/Image/bg; some maps name Flash files or nothing, which are skipped) and
 * \`<fog color="199,237,255" near="5276" far="20000"/>\` the distance fog. \`backdropExists\` says whether a converted image
 * is there, so a missing one is left out.
 */
export function parseEnvironment(xml: string, backdropExists: (path: string) => boolean = () => true): MapEnvironment | null {
  const env: MapEnvironment = {};

  const stem = /^(.+)\.dds$/i.exec(attributes(xml, 'clientProperty')?.bgDay?.trim() ?? '')?.[1];
  if (stem) {
    const path = `${BACKDROP_DIR}/${stem}.png`;
    if (backdropExists(path)) env.background = path;
  }

  const fog = attributes(xml, 'fog');
  if (fog) {
    const color = fog.color?.split(',').map((v) => Number(v.trim()));
    const near = Number(fog.near);
    const far = Number(fog.far);
    const validColor = color?.length === 3 && color.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
    if (validColor && Number.isFinite(near) && Number.isFinite(far) && near >= 0 && far > near) {
      env.fog = { color: color as [number, number, number], near, far };
    }
  }

  return env.background || env.fog ? env : null;
}

/** The environment of a map by its xblock name; null when it sets none or has no settings file. */
export function loadEnvironment(xblock: string): MapEnvironment | null {
  const file = resolveAssetPath(`Xml/mapxblock/${xblock}.xml`, EXTRACTED_ROOT, ['xml/mapxblock']);
  if (!file) return null;
  const xml = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return parseEnvironment(xml, (path) => !!resolveAssetPath(`converted/textures/${path}`));
}
