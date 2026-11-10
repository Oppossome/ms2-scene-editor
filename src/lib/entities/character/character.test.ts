import { describe, expect, it } from 'vitest';
import { CharacterEntity } from './character.svelte.js';
import { GroupEntity } from '../group.svelte.js';
import { controlContext, controlRow } from '../testing.js';

describe('CharacterEntity controls', () => {
  it('offers automatic/manual faces and appearance only on characters', () => {
    const character = new CharacterEntity();
    character.set({ expression: 'smile' });
    const context = controlContext(character);
    const expression = controlRow(context, 'expression');
    expect(expression).toMatchObject({ type: 'enum', value: 'smile' });
    if (expression.type !== 'enum') throw new Error('Expected enum');
    expect(expression.options).toContainEqual({ value: '', label: 'Automatic (animation)' });
    expect(expression.edit('')).toEqual({ expression: undefined });
    expect(() => character.prepare(expression.edit('../file'))).toThrow(/expression/);
    const group = new GroupEntity();
    expect(group.controls(controlContext(group)).find((control) => control.key === 'expression')).toBeUndefined();
    expect(controlRow(context, 'eye')).toMatchObject({ type: 'palette', value: 5, palette: 3, channel: 0 });
    expect(controlRow(context, 'gender')).toMatchObject({ value: '1' });
    expect(controlRow(context, 'skin')).toMatchObject({ palette: 1 });
  });
});
