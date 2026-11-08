import type { MapData } from '../types.js';

/** Parse "1, 2.5, -3" into numbers; returns null unless exactly `count` finite values are present. */
export function parseNumbers(text: string | undefined, count: number): number[] | null {
  if (text === undefined) return null;
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

const ENTITY = /<entity\s+([^>]*?)\s*>([\s\S]*?)<\/entity>/g;
const PROPERTY = /<property\s+name="([^"]+)"[^>]*>\s*<set\s+value="([^"]*)"/g;

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
}

/**
 * Turn an xblock (the map's entity list) into a compact placement list.
 * - `flats`: lowercase flat model name -> converted model path
 * - `llids`: lowercase asset id -> converted model path (an entity's own NifAsset overrides its flat's model)
 * Entities without a renderable model (waypoints, triggers, spawners) and hidden ones are skipped.
 */
export function parseXblock(
  text: string,
  flats: Record<string, string>,
  llids: Record<string, string>
): Pick<MapData, 'models' | 'items'> & { total: number; unresolved: Record<string, number> } {
  const models: string[] = [];
  const modelIndex = new Map<string, number>();
  const items: number[][] = [];
  const unresolved: Record<string, number> = {};
  let total = 0;

  for (const match of text.matchAll(ENTITY)) {
    total++;
    const attrs = match[1];
    const body = match[2];
    const modelName = (attr(attrs, 'modelName') ?? '').toLowerCase();

    const props: Record<string, string> = {};
    for (const p of body.matchAll(PROPERTY)) props[p[1]] = p[2];

    if (props.IsVisible?.toLowerCase() === 'false') continue;

    let glb: string | undefined;
    const llid = /^urn:llid:([0-9a-f-]+)$/i.exec(props.NifAsset ?? '')?.[1]?.toLowerCase();
    if (llid) glb = llids[llid];
    glb ??= flats[modelName];
    if (!glb) {
      unresolved[modelName] = (unresolved[modelName] ?? 0) + 1;
      continue;
    }

    const position = parseNumbers(props.Position, 3) ?? [0, 0, 0];
    const rotation = parseNumbers(props.Rotation, 3) ?? [0, 0, 0];
    const scale = parseNumbers(props.Scale, 3) ?? (parseNumbers(props.Scale, 1) ?? [1]).flatMap((s) => [s, s, s]);

    let index = modelIndex.get(glb);
    if (index === undefined) {
      index = models.length;
      models.push(glb);
      modelIndex.set(glb, index);
    }
    items.push([index, ...position, ...rotation, ...scale]);
  }
  return { models, items, total, unresolved };
}
