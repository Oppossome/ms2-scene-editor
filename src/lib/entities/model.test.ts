import { AnimationClip, Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpcEntity } from './model.svelte.js';
import { controlContext, renderContext } from './testing.js';

const mocks = vi.hoisted(() => ({ instantiate: vi.fn() }));
vi.mock('../assets/loader.js', () => mocks);

let model: NpcEntity | undefined;
afterEach(() => {
  model?.dispose();
  model = undefined;
  mocks.instantiate.mockReset();
});

describe('ModelEntity rendering', () => {
  it('updates transform, playback and the held frame without loading the model again', async () => {
    mocks.instantiate.mockResolvedValue({ object: new Group(), animations: [new AnimationClip('idle', 2, [])] });
    model = new NpcEntity({ id: 'npc' });
    model.set({ name: 'NPC', glb: 'Npc/a.glb', clip: 'idle' });
    const context = renderContext();
    model.render(context);
    await vi.waitFor(() => expect(model?.player?.clip?.name).toBe('idle'));
    const object = model.object;
    model.set({ position: [1, 2, 3], speed: 2, freeze: 12 });
    model.render(context);
    expect(model.object).toBe(object);
    expect(model.object?.position.toArray()).toEqual([1, 2, 3]);
    expect(model.player?.time).toBeCloseTo(0.4);
    expect(model.player?.mixer.timeScale).toBe(2);
    expect(mocks.instantiate).toHaveBeenCalledTimes(1);
    model.set({ freeze: undefined });
    model.render(context);
    model.tick(0.1);
    expect(model.player!.time).toBeGreaterThan(0.4);
    expect(model).toBeInstanceOf(NpcEntity);
    expect(new Set(model.controls(controlContext(model)).map((row) => row.section))).toEqual(
      new Set(['Data', 'Transform', 'Appearance', 'Source', 'Behaviour'])
    );
  });
});
