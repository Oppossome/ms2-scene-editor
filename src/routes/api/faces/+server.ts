import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFaceAnimations } from '#lib/server/faces.js';

export const GET: RequestHandler = ({ url }) => {
  const gender = url.searchParams.get('gender');
  const itemId = url.searchParams.get('itemId') ?? undefined;
  if (gender !== '0' && gender !== '1') error(400, 'gender must be 0 or 1');
  if (itemId && !/^1\d{7}$/.test(itemId)) error(400, 'Invalid face item id');
  try {
    return json(loadFaceAnimations(gender === '0' ? 0 : 1, itemId));
  } catch (cause) {
    console.error('Could not load face animations', cause);
    error(500, 'Could not load face animations');
  }
};
