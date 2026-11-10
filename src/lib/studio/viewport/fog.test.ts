import { describe, expect, it } from 'vitest';
import { fogRange, GAME_CAMERA_DISTANCE } from './fog.js';

const fog = { color: [1, 2, 3] as [number, number, number], near: 5276, far: 20000 };

describe('fogRange', () => {
  it('is the map\'s own range at the game camera distance', () => {
    expect(fogRange(fog, GAME_CAMERA_DISTANCE)).toEqual({ near: 5276, far: 20000 });
  });

  it('moves with the camera, so a far view is not fogged over', () => {
    expect(fogRange(fog, 10_000)).toEqual({ near: 5276 + 8900, far: 20000 + 8900 });
  });

  it('never starts before the camera and always has a positive range', () => {
    expect(fogRange({ near: 0, far: 2000 }, 100)).toEqual({ near: 0, far: 1000 });
    const tight = fogRange({ near: 100, far: 150 }, 0);
    expect(tight.near).toBe(0);
    expect(tight.far).toBeGreaterThan(tight.near);
  });
});
