import { describe, expect, it } from 'vitest';
import { NpcEntity } from './model.svelte.js';
import { GroupEntity } from './group.svelte.js';
import { controlContext, controlRow } from './testing.js';

describe('RiggedModel controls', () => {
  it('clamps a held frame when choosing a shorter clip, and exposes live playback separately', () => {
    const npc = new NpcEntity();
    npc.set({ clip: 'long', freeze: 80 });
    const context = controlContext(npc, {
      clips: [{ name: 'long', duration: 4 }, { name: 'short', duration: 1 }]
    });
    const clip = controlRow(context, 'clip');
    if (clip.type !== 'clip') throw new Error('Expected clip picker');
    expect(clip.edit('short')).toEqual({ clip: 'short', freeze: 30 });
    expect(controlRow(context, 'playback')).toMatchObject({ type: 'transport', frame: 80, max: 120 });
    expect(controlRow(context, 'speed')).toMatchObject({ value: 1, min: 0.05 });
    const group = new GroupEntity();
    expect(group.controls(controlContext(group)).find((control) => control.key === 'clip')).toBeUndefined();
  });
});
