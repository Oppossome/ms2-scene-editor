import { describe, expect, it, vi } from 'vitest';
import type { CharacterEntity } from '../scene/entity.svelte';
import { SceneState } from '../scene/store.svelte';
import { Studio } from './controller.svelte';

/** Just what the frame methods use of a Studio: the scene, a runtime with clips, and the step timer. */
function setup(frameNow = 0) {
  const store = new SceneState();
  const id = store.addCharacter({ name: 'A', gender: 1 });
  store.update(id, { clip: 'idle_a' }, false);
  const runtime = {
    clipsOf: () => [{ name: 'idle_a', duration: 2.1 }],
    currentFrame: () => frameNow
  };
  const studio = { store, runtime, lastStep: { id: '', at: 0 }, setFrame: Studio.prototype.setFrame, inBurst: Studio.prototype.inBurst };
  const call = {
    setFrame: (frame: number, record?: boolean) => Studio.prototype.setFrame.call(studio, id, frame, record),
    stepFrame: (delta: number) => Studio.prototype.stepFrame.call(studio, id, delta),
    holdFrame: (frame: number) => Studio.prototype.holdFrame.call(studio, id, frame)
  };
  return { store, id, call, freeze: () => (store.node(id) as CharacterEntity | undefined)?.freeze, undoDepth: () => depth(store) };
}

/** How many undo steps the frame edits made (adding the character is one step of its own). */
function depth(store: SceneState): number {
  let n = 0;
  while (store.canUndo && n < 100) {
    store.undo();
    n++;
  }
  return n - 1;
}

describe('Studio.setFrame', () => {
  it('holds a node on a whole frame inside its clip', () => {
    const s = setup();
    s.call.setFrame(10.4);
    expect(s.freeze()).toBe(10);
    s.call.setFrame(999);
    expect(s.freeze()).toBe(63);
    s.call.setFrame(-5);
    expect(s.freeze()).toBe(0);
  });

  it('records one undo step, or none while a drag already did', () => {
    const s = setup();
    s.call.setFrame(5);
    s.call.setFrame(6, false);
    s.call.setFrame(7, false);
    expect(s.freeze()).toBe(7);
    // the first change recorded; the drag steps after it did not
    expect(s.undoDepth()).toBe(1);
  });
});

describe('Studio.stepFrame', () => {
  it('steps from the frame the animation is on while it plays, then from the held frame', () => {
    const s = setup(20);
    s.call.stepFrame(1);
    expect(s.freeze()).toBe(21);
    s.call.stepFrame(-3);
    expect(s.freeze()).toBe(18);
  });

  it('wraps round the clip', () => {
    const s = setup(0);
    s.call.stepFrame(-1);
    expect(s.freeze()).toBe(63);
    s.call.stepFrame(1);
    expect(s.freeze()).toBe(0);
  });

  it('makes quick steps on one node a single undo step, and a pause a new one', () => {
    const now = vi.spyOn(performance, 'now');
    const s = setup(10);
    now.mockReturnValue(10_000);
    s.call.stepFrame(1);
    now.mockReturnValue(10_200);
    s.call.stepFrame(1);
    now.mockReturnValue(10_400);
    s.call.stepFrame(1);
    expect(s.freeze()).toBe(13);
    now.mockReturnValue(20_000);
    s.call.stepFrame(1);
    expect(s.freeze()).toBe(14);
    expect(s.undoDepth()).toBe(2);
    now.mockRestore();
  });

  it('groups quick slider input (keys) into one undo step, like stepping', () => {
    const now = vi.spyOn(performance, 'now');
    const s = setup();
    now.mockReturnValue(5_000);
    s.call.holdFrame(3);
    now.mockReturnValue(5_100);
    s.call.holdFrame(4);
    now.mockReturnValue(5_200);
    s.call.stepFrame(1);
    expect(s.freeze()).toBe(5);
    expect(s.undoDepth()).toBe(1);
    now.mockRestore();
  });

  it('does nothing for a node without animations', () => {
    const store = new SceneState();
    const id = store.addCharacter({ name: 'A', gender: 1 });
    const studio = {
      store,
      runtime: { clipsOf: () => [], currentFrame: () => 0 },
      lastStep: { id: '', at: 0 },
      setFrame: Studio.prototype.setFrame,
      inBurst: Studio.prototype.inBurst
    };
    Studio.prototype.stepFrame.call(studio, id, 1);
    expect((store.node(id) as CharacterEntity | undefined)?.freeze).toBeUndefined();
  });
});
