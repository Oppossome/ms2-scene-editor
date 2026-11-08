import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFlats } from '#lib/server/index-data.js';
import { searchByName } from '#lib/server/query.js';
import type { PropRecord } from '#lib/types.js';

let cached: { source: Record<string, string>; props: PropRecord[] } | null = null;

function props(): PropRecord[] {
  const flats = getFlats();
  if (!cached || cached.source !== flats) {
    cached = { source: flats, props: Object.entries(flats).map(([name, glb]) => ({ id: name, name, glb })) };
  }
  return cached.props;
}

export const GET: RequestHandler = ({ url }) =>
  json(
    searchByName(
      props(),
      url.searchParams.get('q'),
      Number(url.searchParams.get('offset') ?? 0),
      Number(url.searchParams.get('limit') ?? 60)
    )
  );
