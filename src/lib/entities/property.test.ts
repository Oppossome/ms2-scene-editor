import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EntityProperty, Vector3Property } from './property.svelte.js';
import { GroupEntity } from './group.svelte.js';
import { controlContext } from './testing.js';

describe('EntityProperty', () => {
  it('owns immutable copies of its initial and assigned values', () => {
    const initial = { values: [1, 2] };
    const property = new EntityProperty(z.object({ values: z.array(z.number()) }), initial);
    initial.values[0] = 9;
    expect(property.value).toEqual({ values: [1, 2] });
    expect(() => property.value.values.push(3)).toThrow();
    property.assign(property.parse({ values: [4, 5] }));
    expect(property.value).toEqual({ values: [4, 5] });
    expect(() => { property.value.values[0] = 0; }).toThrow();
  });

  it('validates without assigning and has no editor unless one is declared', () => {
    const property = new EntityProperty(z.number().nonnegative(), 1);
    expect(property.parse(2)).toBe(2);
    expect(property.value).toBe(1);
    expect(() => property.parse(-1)).toThrow();
    expect(property.control(controlContext(new GroupEntity()))).toBeNull();
  });
});

describe('Vector3Property', () => {
  it('normalizes signed zero and rejects incomplete or non-finite vectors', () => {
    const property = new Vector3Property('rotation', [0, 0, 0]);
    const parsed = property.parse([-0, 0, -0]);
    expect(Object.is(parsed[0], 0)).toBe(true);
    expect(Object.is(parsed[2], 0)).toBe(true);
    expect(() => property.parse([1, 2])).toThrow();
    expect(() => property.parse([1, Infinity, 3])).toThrow();
  });
});
