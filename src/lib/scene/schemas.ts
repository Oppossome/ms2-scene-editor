import { z } from 'zod';
import { FACE_OVERRIDES } from '../character/expressions.js';
import type { ChannelIndexes } from '../character/tint.js';

export function omitUndefined<T extends object>(value: T): T {
  for (const key in value) if (value[key] === undefined) delete value[key];
  return value;
}

export const finite = z.number().finite();
// `+ 0` turns -0 into 0, so a saved and restored vector compare equal.
export const vectorSchema = z
  .tuple([finite, finite, finite])
  .transform((v): [number, number, number] => [v[0] + 0, v[1] + 0, v[2] + 0]);
export const indexSchema = finite.int().nonnegative();
export const numericId = z.string().regex(/^\d+$/);
export const expressionSchema = z.enum(FACE_OVERRIDES);
export const channelsSchema = z
  .object({
    ch0: indexSchema.optional().catch(undefined),
    ch1: indexSchema.optional().catch(undefined),
    ch2: indexSchema.optional().catch(undefined)
  })
  .transform((value): ChannelIndexes | undefined =>
    Object.values(value).some((v) => v !== undefined) ? omitUndefined(value) : undefined
  );
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

/** Version 3 saves `entities` tagged with `type`; versions 1 and 2 saved `nodes` tagged with `kind`. */
export const sceneEnvelopeSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  nodes: z.array(z.unknown()).optional(),
  entities: z.array(z.unknown()).optional()
});

export const outfitSchema = z
  .object({
    version: z.literal(1),
    gender: z.union([z.literal(0), z.literal(1)]),
    skin: indexSchema.catch(0),
    eye: indexSchema.optional().catch(undefined),
    expression: expressionSchema.optional().catch(undefined),
    items: z.array(
      z
        .object({
          id: numericId,
          color: indexSchema.optional().catch(undefined),
          channels: channelsSchema.optional().catch(undefined)
        })
        .transform(omitUndefined)
    )
  })
  .transform(omitUndefined);

export function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`).join('; ');
}
