import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { composeMap, decomposeForScene } from './entities';
import { entityMatrix } from './instancing';
import { GroupEntity } from '../entities/group.svelte.js';
import { LightingEntity } from '../entities/lighting.svelte.js';
import { PropEntity } from '../entities/prop.svelte.js';
import type { MapData } from '../types';

const source: MapData = {
  id: '1', name: 'Test map', models: ['Map/a.glb'],
  items: [[0, 10, 20, 30, 0, 0, 0, 1, 1, 1]], total: 3, unresolved: 2,
  environment: { background: 'Resource/Image/bg/test.png', fog: { color: [1, 2, 3], near: 10, far: 100 } }
};

describe('decomposeForScene', () => {
  const matrix = (position: number[], rotation: number[], scale: number[]) =>
    new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ')), new Vector3(...scale));

  it('round-trips a placement', () => {
    const m = matrix([1, 2, 3], [0.1, 0.5, -0.3], [2, 2, 2]);
    const parts = decomposeForScene(m);
    expect(parts.position).toEqual([1, 2, 3]);
    expect(parts.scale.every((s) => Math.abs(s - 2) < 1e-6)).toBe(true);
    matrix(parts.position, parts.rotation, parts.scale).elements.forEach((v, i) => expect(v).toBeCloseTo(m.elements[i], 5));
  });

  it('extracts the permuted scale of a Z-up placement', () => {
    const { scale } = decomposeForScene(entityMatrix([0, 0, 300, 0, 0, 0, 90, 2, 2, 2]));
    expect(scale.map((s) => Math.round(s * 1000) / 1000)).toEqual([2, 2, 2]);
  });
});

describe('composeMap', () => {
  it('creates ordinary editable props and Lighting with converted placements', () => {
    const group = new GroupEntity({ id: 'map' });
    const children = composeMap(group, source);
    expect(children).toHaveLength(2);
    expect(children[0]).toBeInstanceOf(PropEntity);
    expect(children[0]).toMatchObject({ parentId: 'map', glb: 'Map/a.glb', instanced: true });
    children[0].position.forEach((v, i) => expect(v).toBeCloseTo([10, 30, -20][i]));
    expect(children[1]).toBeInstanceOf(LightingEntity);
    expect(children[1]).toMatchObject({ environment: source.environment });
    expect((composeMap(group, { ...source, items: [], environment: undefined })[0] as LightingEntity).environment).toEqual({});
  });
});
