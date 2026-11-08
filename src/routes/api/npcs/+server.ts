import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNpcs } from '#lib/server/index-data.js';
import { searchByName } from '#lib/server/query.js';

export const GET: RequestHandler = ({ url }) =>
  json(
    searchByName(
      getNpcs(),
      url.searchParams.get('q'),
      Number(url.searchParams.get('offset') ?? 0),
      Number(url.searchParams.get('limit') ?? 60)
    )
  );
