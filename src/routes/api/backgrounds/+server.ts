import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EXTRACTED_ROOT } from '#lib/server/assets.js';

/** Names of the map backdrop images (without extension), for the background picker. */
export const GET: RequestHandler = () => {
  try {
    const names = fs
      .readdirSync(path.join(EXTRACTED_ROOT, 'converted/textures/Resource/Image/bg'))
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => f.slice(0, -4))
      .sort((a, b) => a.localeCompare(b));
    return json(names);
  } catch {
    return json([]);
  }
};
