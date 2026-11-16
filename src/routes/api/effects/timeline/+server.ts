import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEffectTimeline } from '#lib/server/effects.js';

/** An effect XML as a timeline: ?path=<path relative to Xml/effect>. */
export const GET: RequestHandler = ({ url }) => {
  const path = url.searchParams.get('path');
  if (!path) error(400, 'path is required');
  const timeline = loadEffectTimeline(path);
  if (!timeline) error(404, `No effect ${path}`);
  return json(timeline);
};
