import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import type { MapData } from '../types';
import { decomposeForScene, extractNearby, sceneMatrix } from './extract';

const data: MapData = {
  id: '1',
  name: 'Test',
  models: ['a.glb', 'b.glb'],
  // Game space (Z-up): world position is (x, z, -y).
  items: [
    [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
    [1, 100, 0, 0, 0, 0, 0, 1, 1, 1],
    [0, 0, 300, 0, 0, 0, 90, 2, 2, 2],
    [1, 5000, 5000, 0, 0, 0, 0, 1, 1, 1]
  ],
  total: 4,
  unresolved: 0
};

describe('extractNearby', () => {
  it('returns props within the radius, nearest first', () => {
    const near = extractNearby(data, new Vector3(0, 0, 0), 400, 10);
    expect(near.map((p) => p.glb)).toEqual(['a.glb', 'b.glb', 'a.glb']);
    expect(near.map((p) => Math.round(p.distance))).toEqual([0, 100, 300]);
  });

  it('respects the limit and uses Y-up distances', () => {
    expect(extractNearby(data, new Vector3(0, 0, 0), 400, 2)).toHaveLength(2);
    // game (0, 300, 0) is world (0, 0, -300)
    const near = extractNearby(data, new Vector3(0, 0, -300), 10, 5);
    expect(near).toHaveLength(1);
    expect(near[0].matrix.elements[14]).toBeCloseTo(-300, 4);
  });
});

describe('decomposeForScene / sceneMatrix', () => {
  it('round-trips a placement', () => {
    const m = sceneMatrix([1, 2, 3], [0.1, 0.5, -0.3], [2, 2, 2]);
    const parts = decomposeForScene(m);
    expect(parts.position).toEqual([1, 2, 3]);
    expect(parts.scale.every((s) => Math.abs(s - 2) < 1e-6)).toBe(true);
    const back = sceneMatrix(parts.position, parts.rotation, parts.scale);
    back.elements.forEach((v, i) => expect(v).toBeCloseTo(m.elements[i], 5));
  });

  it('extracts the permuted scale of a Z-up placement', () => {
    const { scale } = decomposeForScene(extractNearby(data, new Vector3(0, 0, 0), 400, 10)[2].matrix);
    expect(scale.map((s) => Math.round(s * 1000) / 1000)).toEqual([2, 2, 2]);
    expect(new Matrix4().identity().elements[0]).toBe(1);
  });
});
