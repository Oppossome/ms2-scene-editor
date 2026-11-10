import { z } from 'zod';
import { finite } from '../entities/validation.js';

const fogSchema = z
  .object({
    color: z.tuple([finite.min(0).max(255), finite.min(0).max(255), finite.min(0).max(255)]),
    near: finite.nonnegative(),
    far: finite.positive()
  })
  .refine((fog) => fog.far > fog.near, { message: 'Fog far must be greater than near' });
export const environmentSchema = z.object({
  background: z.string().optional(),
  fog: fogSchema.optional()
});
