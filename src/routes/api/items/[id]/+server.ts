import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getItemById, getPalettes } from '#lib/server/index-data.js';

export const GET: RequestHandler = ({ params }) => {
  const item = getItemById(params.id);
  if (!item) error(404, 'Unknown item');
  const colors = item.palette ? (getPalettes()[String(item.palette)] ?? []) : [];
  return json({ ...item, colors });
};
