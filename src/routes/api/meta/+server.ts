import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeta } from '#lib/server/index-data.js';

export const GET: RequestHandler = () => json(getMeta());
