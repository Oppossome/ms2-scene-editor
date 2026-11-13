import { z } from 'zod';
import { FACE_OVERRIDES } from './expressions.js';
import { HOLD_MODES } from './weapons.js';
import { CUSTOM_DYE, type ChannelDyes, type Dye } from './tint.js';
import { indexSchema, omitUndefined } from '../validation.js';
import { USER_TEXTURE_ID } from '../../assets/user-textures.js';

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

/** A texture key: the lower-case file name of one of an item's colour maps (see `texture-override.ts`). */
export const TEXTURE_KEY = /^[a-z0-9_.-]+\.(png|jpe?g)$/;

/**
 * Texture overrides of an item: texture key -> id of an image stored in the browser (`assets/user-textures.ts`).
 * Entries that are not one are dropped; none at all is undefined.
 */
export const texturesSchema = z
  .record(z.string(), z.unknown())
  .transform((value): Record<string, string> | undefined => {
    const entries = Object.entries(value).filter(
      (entry): entry is [string, string] =>
        TEXTURE_KEY.test(entry[0]) && typeof entry[1] === 'string' && USER_TEXTURE_ID.test(entry[1])
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  });
