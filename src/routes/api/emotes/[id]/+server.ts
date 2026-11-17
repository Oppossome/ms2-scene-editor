import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEmotes } from '#lib/server/index-data.js';

export const GET: RequestHandler = ({ params }) => {
  const emote = getEmotes().find((s) => s.id === params.id);
  if (!emote) error(404, `No emote ${params.id}`);
  return json(emote);
};
