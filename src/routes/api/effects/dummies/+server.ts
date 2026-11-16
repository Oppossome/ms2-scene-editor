import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPlayerDummies } from '#lib/server/effects.js';

/** Player effect attachment points: ?gender=0|1. */
export const GET: RequestHandler = ({ url }) => json(loadPlayerDummies(url.searchParams.get('gender') === '0' ? 0 : 1));
