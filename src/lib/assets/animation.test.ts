import { AnimationClip, Group, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { AnimationPlayer } from './animation';

/** Moves along x at one unit per second for two seconds. */
const slide = () => new AnimationClip('slide', 2, [new VectorKeyframeTrack('.position', [0, 2], [0, 0, 0, 2, 0, 0])]);

function setup() {
  const root = new Group();
  const player = new AnimationPlayer(root);
  player.play(slide());
  return { root, player };
}

describe('AnimationPlayer freeze', () => {
  it('holds the pose of the frozen moment while time passes', () => {
    const { root, player } = setup();
    player.update(0.5);
    player.freeze(1.5);
    expect(root.position.x).toBeCloseTo(1.5);
    player.update(1);
    player.update(1);
    expect(root.position.x).toBeCloseTo(1.5);
    expect(player.frozen).toBe(true);
    expect(player.playing).toBe(false);
  });

  it('clamps the frame to the clip', () => {
    const { root, player } = setup();
    player.freeze(99);
    expect(root.position.x).toBeCloseTo(2);
    player.freeze(-4);
    expect(root.position.x).toBeCloseTo(0);
  });

  it('carries on from the frozen frame when released', () => {
    const { root, player } = setup();
    player.freeze(1);
    player.unfreeze();
    expect(player.frozen).toBe(false);
    player.update(0.5);
    expect(root.position.x).toBeCloseTo(1.5);
  });

  it('can move the frozen frame', () => {
    const { root, player } = setup();
    player.freeze(0.5);
    player.freeze(1.25);
    expect(root.position.x).toBeCloseTo(1.25);
  });

  it('does nothing without a clip, and a new clip starts unfrozen', () => {
    const player = new AnimationPlayer(new Group());
    player.freeze(1);
    expect(player.frozen).toBe(false);
    player.play(slide());
    player.freeze(1);
    player.play(slide());
    expect(player.frozen).toBe(false);
    expect(player.playing).toBe(true);
  });
});
