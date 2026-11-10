import { describe, expect, it } from 'vitest';
import { GroupEntity } from './group.svelte.js';
import { controlContext, controlRow } from './testing.js';

describe('entity state', () => {
  it('gives each entity its own immutable values', () => {
    const source = { type: 'group', id: 'a', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const first = new GroupEntity(source).restore(source);
    const second = new GroupEntity(source).restore(source);
    (source.position as number[])[0] = 90;
    expect(first.position).toEqual([0, 0, 0]);
    expect(() => { (first.position as number[])[0] = 50; }).toThrow();
    const saved = first.toJSON();
    expect(saved.position).toEqual([0, 0, 0]);
    expect(second.position).toEqual([0, 0, 0]);
  });

  it('validates a whole edit before accepting any of it', () => {
    const group = new GroupEntity();
    group.set({ name: 'a' });
    expect(() => group.prepare({ name: 'Changed', position: [0, Infinity, 0] })).toThrow(/position/);
    expect(group.name).toBe('a');
    expect(() => group.prepare({ nope: 1 })).toThrow(/no editable property nope/);
    expect(group.prepare({ name: 'a' }).size).toBe(0);
  });

  it('bumps its revision only when a value changes', () => {
    const group = new GroupEntity();
    group.set({ name: 'a' });
    const revision = group.revision;
    group.set({ name: 'a' });
    expect(group.revision).toBe(revision);
    group.set({ name: 'b', position: [1, 2, 3] });
    expect(group.revision).toBe(revision + 1);
    expect(group).toBeInstanceOf(GroupEntity);
  });
});

describe('BaseEntity controls', () => {
  it('describes transforms and converts rotation at the control boundary only', () => {
    const group = new GroupEntity();
    group.set({ rotation: [0, Math.PI / 2, 0] });
    const context = controlContext(group);
    const rotation = controlRow(context, 'rotation');
    expect(rotation).toMatchObject({ type: 'vec3', value: [0, 90, 0] });
    if (rotation.type !== 'vec3') throw new Error('Expected vector control');
    expect(rotation.edit([0, 180, 0])).toEqual({ rotation: [0, Math.PI, 0] });
    expect(new Set(group.controls(context).map((row) => row.section))).toEqual(new Set(['Data', 'Transform', 'Appearance', 'Behaviour']));
  });
});

describe('BaseEntity JSON', () => {
  it('writes only registered values and the type, never runtime state', () => {
    const json = new GroupEntity().toJSON();
    expect(Object.keys(json).sort()).toEqual(['id', 'locked', 'name', 'parentId', 'position', 'rotation', 'scale', 'type', 'visible']);
  });
});
