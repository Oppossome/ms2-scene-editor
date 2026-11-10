import { z } from 'zod';

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
export function issueText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`).join('; ');
}
