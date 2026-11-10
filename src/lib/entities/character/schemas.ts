import { z } from 'zod';
import { FACE_OVERRIDES } from './expressions.js';
import type { ChannelIndexes } from './tint.js';
import { indexSchema, omitUndefined } from '../validation.js';

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
