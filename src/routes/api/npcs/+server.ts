import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNpcs } from '#lib/server/index-data.js';
import { groupNpcs, searchNpcs } from '#lib/server/query.js';

/** The grouped list is rebuilt only when the index is reloaded (the index data object changes then). */
let grouped: { source: unknown; groups: ReturnType<typeof groupNpcs> } | null = null;

export const GET: RequestHandler = ({ url }) => {
  const npcs = getNpcs();
  if (grouped?.source !== npcs) grouped = { source: npcs, groups: groupNpcs(npcs) };
  return json(
    searchNpcs(
      grouped.groups,
      url.searchParams.get('q'),
      Number(url.searchParams.get('offset') ?? 0),
      Number(url.searchParams.get('limit') ?? 60)
    )
  );
};
