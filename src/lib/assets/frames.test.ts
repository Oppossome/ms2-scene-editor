import { describe, expect, it } from 'vitest';
import { lastFrame, stepFrame } from './frames.js';

describe('frame navigation', () => {
  it('steps and wraps frames in either direction', () => {
    expect(lastFrame([{ name: 'idle', duration: 2 }], 'idle')).toBe(60);
    expect(lastFrame([], 'missing')).toBeUndefined();
    expect(stepFrame(0, -1, 60)).toBe(60);
    expect(stepFrame(60, 1, 60)).toBe(0);
    expect(stepFrame(2, -10)).toBe(0);
    expect(stepFrame(0, -10, 0)).toBe(0);
  });
});
