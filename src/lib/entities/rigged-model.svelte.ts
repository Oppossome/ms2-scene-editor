import { z } from 'zod';
import type { AnimationClip } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { idleClip } from '../assets/clips.js';
import { FRAME_RATE, lastFrame } from '../assets/frames.js';
import type { ClipInfo } from '../types.js';
import { BaseEntity } from './base.svelte.js';
import { EntityProperty, type PropContext, type PropertyControl } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { finite, indexSchema } from './validation.js';

const optionalText = z.string().min(1).optional();

/** A model with a skeleton and animation clips: the clip, speed and held frame properties and their playback. */
export abstract class RiggedModel extends BaseEntity {
  readonly clipProperty = this.define('clip', new EntityProperty(optionalText, undefined));
  readonly speedProperty = this.define('speed', new EntityProperty(finite.positive().optional(), undefined));
  readonly freezeProperty = this.define('freeze', new EntityProperty(indexSchema.optional(), undefined));
  get clip() {
    return this.clipProperty.value;
  }
  get speed() {
    return this.speedProperty.value;
  }
  get freeze() {
    return this.freezeProperty.value;
  }

  player: AnimationPlayer | null = null;
  /** Whether the clip repeats (a preview can play it once); not saved, scenes always loop. */
  loop = true;
  protected clipRequested: string | undefined;
  private freezeApplied: number | undefined;

  controls(ctx: PropContext): PropertyControl[] {
    const rows = super.controls(ctx);
    if (!ctx.clips.length) return rows;
    return [
      ...rows,
      {
        key: 'clip',
        label: 'Clip',
        section: 'Animation',
        type: 'clip',
        value: this.clip ?? '',
        clips: ctx.clips,
        edit: (value) => {
          const clip = value || undefined;
          const last = lastFrame(ctx.clips, clip);
          // A held frame stays on the same frame of the new clip, or on its last one when that is shorter.
          return {
            clip,
            ...(this.freeze !== undefined && last !== undefined ? { freeze: Math.min(this.freeze, last) } : {})
          };
        }
      },
      {
        key: 'speed',
        label: 'Speed',
        section: 'Animation',
        type: 'number',
        value: this.speed ?? 1,
        step: 0.1,
        min: 0.05,
        edit: (speed) => ({ speed })
      },
      {
        key: 'playback',
        label: 'Playback',
        section: 'Animation',
        type: 'transport',
        frame:
          this.freeze === undefined ? undefined : Math.min(this.freeze, lastFrame(ctx.clips, this.clip) ?? this.freeze),
        max: lastFrame(ctx.clips, this.clip)
      }
    ];
  }

  render(context: RenderContext) {
    super.render(context);
    if (this.player) this.player.mixer.timeScale = this.speed ?? 1;
    if (this.clipRequested !== this.clip) void this.playClip();
    else if (this.freezeApplied !== this.freeze) this.applyFreeze();
  }

  protected abstract loadClip(name: string): Promise<AnimationClip | undefined>;

  async playClip() {
    const player = this.player;
    const name = this.clip;
    this.clipRequested = name;
    if (!player) return;
    if (!name) return player.stop();
    try {
      const clip = await this.loadClip(name);
      if (this.disposed || this.player !== player || this.clipRequested !== name) return;
      if (clip) player.play(clip, this.loop);
      this.applyFreeze();
      this.tick(0);
    } catch (error) {
      this.context?.error(`Could not play ${name}`, error);
    }
  }

  /** The model and its clips are loaded: publish the clips, give a new model its idle clip, start playing. */
  protected ready(clips: ClipInfo[]) {
    this.context?.clips(this.id, clips);
    this.context?.reparent();
    this.context?.changed();
    if (this.player) this.player.mixer.timeScale = this.speed ?? 1;
    if (!this.clip) {
      const idle = idleClip(clips);
      if (idle) this.context?.defaultClip(this.id, idle);
    }
    void this.playClip();
  }

  private applyFreeze() {
    if (!this.player?.clip) return;
    this.freezeApplied = this.freeze;
    if (this.freeze === undefined) this.player.unfreeze();
    else this.player.freeze(this.freeze / FRAME_RATE);
  }

  tick(delta: number) {
    this.player?.update(delta);
  }

  protected clearPlayer() {
    this.player?.dispose();
    this.player = null;
    this.clipRequested = undefined;
    this.context?.clips(this.id, []);
  }

  dispose() {
    this.clearPlayer();
    super.dispose();
  }
}
