import { describe, expect, it } from 'vitest';
import { faceFrameAt, isFaceExpression, type FaceFrame } from './expressions.js';

const frame = (base: string, duration: number | null): FaceFrame => ({ base, mask: null, duration });

describe('faceFrameAt', () => {
  it('uses frame delays, holds the final frame, and supports backward seeking', () => {
    const frames = [frame('closed', 1010), frame('half', 40), frame('idle', 150)];
    const sequence = { frames, loopStart: null };
    expect(faceFrameAt(sequence, 0)).toBe(frames[0]);
    expect(faceFrameAt(sequence, 1.01)).toBe(frames[1]);
    expect(faceFrameAt(sequence, 1.05)).toBe(frames[2]);
    expect(faceFrameAt(sequence, 3)).toBe(frames[2]);
    expect(faceFrameAt(sequence, 0.1)).toBe(frames[0]);
  });

  it('plays the intro once and loops from the marked frame', () => {
    const frames = [frame('intro', 200), frame('a', 100), frame('b', 100)];
    const sequence = { frames, loopStart: 1 };
    expect(faceFrameAt(sequence, 0.1)).toBe(frames[0]);
    expect(faceFrameAt(sequence, 0.25)).toBe(frames[1]);
    expect(faceFrameAt(sequence, 0.35)).toBe(frames[2]);
    expect(faceFrameAt(sequence, 0.45)).toBe(frames[1]);
  });

  it('holds frames without a delay and tolerates empty and zero-length sequences', () => {
    const frames = [frame('hold', null), frame('unused', 100)];
    expect(faceFrameAt({ frames, loopStart: 0 }, 100)).toBe(frames[0]);
    expect(faceFrameAt({ frames: [], loopStart: null }, 0)).toBeUndefined();
    expect(faceFrameAt({ frames: [frame('zero', 0)], loopStart: 0 }, 10)?.base).toBe('zero');
  });
});

it('validates manual expressions without allowing arbitrary texture paths', () => {
  expect(isFaceExpression('smile')).toBe(true);
  expect(isFaceExpression('blink')).toBe(true);
  expect(isFaceExpression('../other.png')).toBe(false);
  expect(isFaceExpression('automatic')).toBe(false);
});
