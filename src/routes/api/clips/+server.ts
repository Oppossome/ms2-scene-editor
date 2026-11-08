import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EXTRACTED_ROOT } from '#lib/server/assets.js';
import { listClips } from '#lib/server/clips.js';
import { dataFile } from '#lib/server/index-data.js';

/** The per-clip animation files of a body model (e.g. "idle_a", "assassin_dodge_a") with their durations. */
export const GET: RequestHandler = ({ url }) => {
  const gender = url.searchParams.get('gender');
  if (gender !== '0' && gender !== '1') error(400, 'gender must be 0 or 1');
  const dir = path.join(
    EXTRACTED_ROOT,
    'converted/models/Character',
    gender === '0' ? 'male/m_body.anims' : 'female/f_body.anims'
  );
  const clips = listClips(dir, dataFile(`clips-${gender}.json`));
  if (!clips) error(404, 'No clips found');
  return json(clips);
};
