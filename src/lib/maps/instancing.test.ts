import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { entityMatrix } from './instancing';

/** Where a Y-up model-space point ends up for a Z-up placement. */
const place = (item: number[], p: Vector3) => p.clone().applyMatrix4(entityMatrix(item));
const close = (v: Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 4);
  expect(v.y).toBeCloseTo(y, 4);
  expect(v.z).toBeCloseTo(z, 4);
};

describe('entityMatrix', () => {
  it('converts a Z-up position to Y-up (x, z, -y)', () => {
    close(place([0, 100, 200, 300, 0, 0, 0, 1, 1, 1], new Vector3()), 100, 300, -200);
  });

  it('applies uniform and per-axis scale in game space', () => {
    // A point 10 along the model's up (Y-up) axis is 10 along game Z; scaling Z by 3 gives 30.
    close(place([0, 0, 0, 0, 0, 0, 0, 1, 1, 3], new Vector3(0, 10, 0)), 0, 30, 0);
    close(place([0, 0, 0, 0, 0, 0, 0, 2, 2, 2], new Vector3(1, 1, 1)), 2, 2, 2);
  });

  it('rotates about the game Z axis (the vertical axis in the world)', () => {
    // +X rotated 90 degrees about game Z becomes game +Y, which is world -Z.
    close(place([0, 0, 0, 0, 0, 0, 90, 1, 1, 1], new Vector3(1, 0, 0)), 0, 0, -1);
    // The vertical axis is unchanged.
    close(place([0, 0, 0, 0, 0, 0, 90, 1, 1, 1], new Vector3(0, 5, 0)), 0, 5, 0);
  });

  it('applies rotation before translation', () => {
    close(place([0, 10, 0, 0, 0, 0, 180, 1, 1, 1], new Vector3(1, 0, 0)), 9, 0, 0);
  });
});
