import { describe, expect, it } from 'vitest';
import { LightingEntity } from './lighting.svelte.js';
import { controlContext, controlRow } from './testing.js';

describe('LightingEntity controls', () => {
  it('provides environment controls, not transforms, for Lighting', () => {
    const lighting = new LightingEntity();
    lighting.set({ environment: { background: 'sky.png', fog: { color: [1, 2, 3], near: 4, far: 9 } } });
    const context = controlContext(lighting);
    expect(lighting.controls(context).find((control) => control.key === 'position')).toBeUndefined();
    expect(controlRow(context, 'background')).toMatchObject({ value: 'sky.png' });
    expect(controlRow(context, 'fogColor')).toMatchObject({ value: [1, 2, 3] });
  });
});
