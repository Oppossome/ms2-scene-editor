import { describe, expect, it } from 'vitest';
import { controllerTime, hashRandom, particleKeyTime, sampleParticleKeys, sampleTrack } from './timing.js';
import { LoopBehavior, type ControllerTiming } from './types.js';

const ctl = (cycle: ControllerTiming['cycle'], start = 0, stop = 2): ControllerTiming => ({
  start,
  stop,
  frequency: 1,
  phase: 0,
  cycle
});

describe('controller time', () => {
  it('loops, reflects and clamps over the controller span', () => {
    expect(controllerTime(ctl('loop'), 2.5)).toBeCloseTo(0.5);
    expect(controllerTime(ctl('loop'), -0.5)).toBeCloseTo(1.5);
    expect(controllerTime(ctl('reverse'), 2.5)).toBeCloseTo(1.5);
    expect(controllerTime(ctl('reverse'), 4.5)).toBeCloseTo(0.5);
    expect(controllerTime(ctl('clamp'), 5)).toBe(2);
    expect(controllerTime(ctl('clamp'), -1)).toBe(0);
  });

  it('applies frequency and phase before cycling', () => {
    expect(controllerTime({ ...ctl('clamp', 0, 10), frequency: 2, phase: 1 }, 3)).toBe(7);
  });

  it('holds the start of an empty span', () => {
    expect(controllerTime(ctl('loop', 1, 1), 5)).toBe(1);
  });
});

describe('key tracks', () => {
  const track = { interp: 'linear' as const, times: [0, 1, 3], values: [0, 0, 10, 10, 30, 40] };

  it('interpolates linearly and holds the ends', () => {
    expect(sampleTrack(track, 2, -1)).toEqual([0, 0]);
    expect(sampleTrack(track, 2, 0.5)).toEqual([5, 5]);
    expect(sampleTrack(track, 2, 2)).toEqual([20, 25]);
    expect(sampleTrack(track, 2, 9)).toEqual([30, 40]);
  });

  it('steps without interpolating', () => {
    expect(sampleTrack({ ...track, interp: 'step' }, 2, 2.9)).toEqual([10, 10]);
  });
});

describe('particle keys', () => {
  const keys = [
    { time: 0, value: [1, 0, 0, 1] },
    { time: 0.5, value: [0, 1, 0, 1] },
    { time: 1, value: [0, 0, 1, 0] }
  ];

  it('scales age-scaled keys over the particle life', () => {
    expect(particleKeyTime(keys, LoopBehavior.AgeScale, 1, 4)).toBeCloseTo(0.25);
    expect(sampleParticleKeys(keys, particleKeyTime(keys, LoopBehavior.AgeScale, 3, 4), [])).toEqual([
      0, 0.5, 0.5, 0.5
    ]);
  });

  it('maps clamped, looping and reflected ages', () => {
    expect(particleKeyTime(keys, LoopBehavior.ClampBirth, 0.25, 4)).toBe(0.25);
    expect(particleKeyTime(keys, LoopBehavior.ClampDeath, 3.5, 4)).toBe(0.5);
    expect(particleKeyTime(keys, LoopBehavior.Loop, 2.25, 4)).toBeCloseTo(0.25);
    expect(particleKeyTime(keys, LoopBehavior.Reflect, 1.25, 4)).toBeCloseTo(0.75);
  });
});

describe('hash random', () => {
  it('is reproducible and spread over [0, 1)', () => {
    expect(hashRandom(1, 2, 3)).toBe(hashRandom(1, 2, 3));
    expect(hashRandom(1, 2, 3)).not.toBe(hashRandom(2, 2, 3));
    const values = Array.from({ length: 1000 }, (_, i) => hashRandom(7, i, 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
