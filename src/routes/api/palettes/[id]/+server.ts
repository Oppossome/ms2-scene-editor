import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPalettes } from '#lib/server/index-data.js';

export const GET: RequestHandler = ({ params }) => {
  const palette = getPalettes()[params.id];
  if (!palette) error(404, 'Unknown palette');
  return json(palette);
};
