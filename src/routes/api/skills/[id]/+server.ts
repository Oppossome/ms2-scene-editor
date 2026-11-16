import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSkills } from '#lib/server/index-data.js';

export const GET: RequestHandler = ({ params }) => {
  const skill = getSkills().find((s) => s.id === params.id);
  if (!skill) error(404, `No skill ${params.id}`);
  return json(skill);
};
