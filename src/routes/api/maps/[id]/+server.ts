import fs from 'node:fs';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EXTRACTED_ROOT, resolveAssetPath } from '#lib/server/assets.js';
import { getFlats, getLlids, getMaps } from '#lib/server/index-data.js';
import { loadEnvironment } from '#lib/server/environment.js';
import { parseXblock } from '#lib/server/xblock.js';
import type { MapData } from '#lib/types.js';

const cache = new Map<string, MapData>();

export const GET: RequestHandler = ({ params }) => {
  const record = getMaps().find((m) => m.id === params.id);
  if (!record) error(404, 'Unknown map');

  const cached = cache.get(record.id);
  if (cached) return json(cached);

  const file = resolveAssetPath(`Resource/Exported/xblock/${record.xblock}.xblock`, EXTRACTED_ROOT, ['resource/exported/xblock']);
  if (!file) error(404, 'Map data not found');

  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = parseXblock(text, getFlats(), getLlids());
  const data: MapData = {
    id: record.id,
    name: record.name,
    models: parsed.models,
    items: parsed.items,
    total: parsed.total,
    unresolved: Object.values(parsed.unresolved).reduce((a, b) => a + b, 0)
  };
  const environment = loadEnvironment(record.xblock);
  if (environment) data.environment = environment;
  cache.set(record.id, data);
  return json(data);
};
