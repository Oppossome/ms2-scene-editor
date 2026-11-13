import { z } from 'zod';
import { FACE_OVERRIDES } from './expressions.js';
import { HOLD_MODES } from './weapons.js';
import { CUSTOM_DYE, type ChannelDyes, type Dye } from './tint.js';
import { indexSchema, omitUndefined } from '../validation.js';

export const expressionSchema = z.enum(FACE_OVERRIDES);
/** Automatic is the default and is not stored. */
export const holdSchema = z.enum(HOLD_MODES.filter((mode) => mode !== 'auto') as ['hand', 'carry']);
/** A palette row, or a custom `#rrggbb` colour (stored lower-case). */
export const dyeSchema = z.union([
  indexSchema,
  z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().regex(CUSTOM_DYE))
]) as z.ZodType<Dye>;
export const channelsSchema = z
  .object({
    ch0: dyeSchema.optional().catch(undefined),
    ch1: dyeSchema.optional().catch(undefined),
    ch2: dyeSchema.optional().catch(undefined)
  })
  .transform((value): ChannelDyes | undefined =>
    Object.values(value).some((v) => v !== undefined) ? omitUndefined(value) : undefined
  );
