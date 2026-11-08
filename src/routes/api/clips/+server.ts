import fs from 'node:fs';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EXTRACTED_ROOT } from '#lib/server/assets.js';
import path from 'node:path';

/** Names of the per-clip animation files of a body model (e.g. "idle_a", "assassin_dodge_a"). */
export const GET: RequestHandler = ({ url }) => {
  const gender = url.searchParams.get('gender');
  if (gender !== '0' && gender !== '1') error(400, 'gender must be 0 or 1');
  const dir = path.join(
    EXTRACTED_ROOT,
    'converted/models/Character',
    gender === '0' ? 'male/m_body.anims' : 'female/f_body.anims'
  );
  if (!fs.existsSync(dir)) error(404, 'No clips found');
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .map((f) => f.replace(/\.glb$/i, ''))
    .sort();
  return json(names);
};
