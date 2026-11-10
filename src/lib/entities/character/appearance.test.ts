import { describe, expect, it } from 'vitest';
import { editableChannels, hasOwnColours } from './appearance.js';

describe('shared property helpers', () => {
  it('matches palette channels and excludes face item colours', () => {
    expect(editableChannels([true, true])).toEqual([0, 2]);
    expect(editableChannels([false, false])).toEqual([]);
    expect(hasOwnColours({ slots: ['FA'] })).toBe(false);
    expect(hasOwnColours({ slots: ['CP'] })).toBe(true);
    expect(hasOwnColours(null)).toBe(false);
  });
});
