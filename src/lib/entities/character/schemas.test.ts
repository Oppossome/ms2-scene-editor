import { describe, expect, it } from 'vitest';
import { channelsSchema, expressionSchema } from './schemas.js';

describe('expressionSchema', () => {
  it('accepts a known expression and rejects unknown names and texture paths', () => {
    expect(expressionSchema.parse('smile')).toBe('smile');
    expect(expressionSchema.safeParse('not-an-expression').success).toBe(false);
    expect(expressionSchema.safeParse('../file.png').success).toBe(false);
  });
});

describe('channelsSchema', () => {
  it('keeps valid channel indexes and removes invalid or unknown entries', () => {
    expect(channelsSchema.parse({ ch0: 3, ch1: -4, ch2: 1, junk: 9 })).toEqual({ ch0: 3, ch2: 1 });
    expect(channelsSchema.parse({ ch0: 0, ch1: 2, ch2: 4 })).toEqual({ ch0: 0, ch1: 2, ch2: 4 });
  });

  it('omits empty picks but rejects non-object input', () => {
    expect(channelsSchema.parse({})).toBeUndefined();
    expect(channelsSchema.parse({ ch0: 'x', ch1: 1.5, ch2: Infinity })).toBeUndefined();
    expect(channelsSchema.safeParse(null).success).toBe(false);
    expect(channelsSchema.safeParse([]).success).toBe(false);
  });
});
