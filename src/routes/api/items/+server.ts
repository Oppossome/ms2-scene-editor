import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getItems } from '#lib/server/index-data.js';
import { searchItems } from '#lib/server/query.js';
import type { Gender } from '#lib/types.js';

export const GET: RequestHandler = ({ url }) => {
  const g = url.searchParams.get('gender');
  const gender = g === '0' || g === '1' || g === '2' ? (Number(g) as Gender) : undefined;
  return json(
    searchItems(getItems(), {
      q: url.searchParams.get('q') ?? undefined,
      slot: url.searchParams.get('slot') ?? undefined,
      cls: url.searchParams.get('cls') ?? undefined,
      gender,
      offset: Number(url.searchParams.get('offset') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 60)
    })
  );
};
