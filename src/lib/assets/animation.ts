import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three';

/** Thin wrapper around an AnimationMixer for one object: one clip plays at a time. */
export class AnimationPlayer {
  readonly mixer: AnimationMixer;
  private action: AnimationAction | null = null;
  clip: AnimationClip | null = null;
  playing = false;

  constructor(root: Object3D) {
    this.mixer = new AnimationMixer(root);
  }

  play(clip: AnimationClip, loop = true) {
    this.action?.stop();
    this.mixer.uncacheClip(this.clip ?? clip);
    this.clip = clip;
    const action = this.mixer.clipAction(clip);
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().play();
    action.paused = false;
    this.action = action;
    this.playing = true;
  }

  pause() {
    if (this.action) this.action.paused = true;
    this.playing = false;
  }

  resume() {
    if (this.action) this.action.paused = false;
    this.playing = true;
  }

  stop() {
    this.action?.stop();
    this.action = null;
    this.clip = null;
    this.playing = false;
  }

  get time() {
    return this.action?.time ?? 0;
  }

  seek(seconds: number) {
    if (!this.action) return;
    this.action.time = Math.min(Math.max(0, seconds), this.clip?.duration ?? 0);
    this.mixer.update(0);
  }

  update(delta: number) {
    this.mixer.update(delta);
  }

  dispose() {
    this.mixer.stopAllAction();
    if (this.clip) this.mixer.uncacheClip(this.clip);
  }
}
