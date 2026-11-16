import { z } from 'zod';
import type { AnimationClip } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { idleClip } from '../assets/clips.js';
import { FRAME_RATE, lastFrame } from '../assets/frames.js';
import type { ClipInfo, EffectDummy, SkillRecord } from '../types.js';
import { fetchTimeline, TimelinePlayer, type TimelineHost } from '../assets/effects/timeline.js';
import { BaseEntity } from './base.svelte.js';
import { EntityProperty, type PropContext, type PropertyControl } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { finite, indexSchema } from './validation.js';

const optionalText = z.string().min(1).optional();

/** The skill a model shows: the effects of one of its motions play while that motion's clip does. */
export const skillSchema = z.object({ id: z.string().min(1), name: z.string(), motion: indexSchema }).optional();
export type SkillRef = z.infer<typeof skillSchema>;

const skillCache = new Map<string, Promise<SkillRecord | null>>();
function fetchSkill(id: string): Promise<SkillRecord | null> {
  let hit = skillCache.get(id);
  if (!hit) {
    hit = fetch(`/api/skills/${encodeURIComponent(id)}`).then((r) =>
      r.ok
        ? (r.json() as Promise<SkillRecord>)
        : r.status === 404
          ? null
          : Promise.reject(new Error(`HTTP ${r.status}`))
    );
    hit.catch(() => skillCache.delete(id));
    skillCache.set(id, hit);
  }
  return hit;
}

/** A model with a skeleton and animation clips: the clip, speed and held frame properties and their playback. */
export abstract class RiggedModel extends BaseEntity {
  readonly clipProperty = this.define('clip', new EntityProperty(optionalText, undefined));
  readonly speedProperty = this.define('speed', new EntityProperty(finite.positive().optional(), undefined));
  readonly freezeProperty = this.define('freeze', new EntityProperty(indexSchema.optional(), undefined));
  readonly skillProperty = this.define(
    'skill',
    new EntityProperty(skillSchema, undefined, (value) =>
      value
        ? { key: 'skill', label: 'Skill', section: 'Animation', type: 'readonly', value: `${value.name} (${value.id})` }
        : null
    )
  );
  get skill() {
    return this.skillProperty.value;
  }
  /** The skill's effects, and the clip they belong to. */
  private skillEffects: { clip: string | null; players: TimelinePlayer[] } | null = null;
  private skillApplied: string | undefined;
  private skillGen = 0;
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
    if (this.skill)
      rows.push({
        key: 'stopSkill',
        label: '',
        section: 'Animation',
        type: 'action',
        value: 'Stop skill effects',
        edit: () => ({ skill: undefined })
      });
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
    if (JSON.stringify(this.skill ?? null) !== this.skillApplied) void this.loadSkill();
  }

  /** Where skill effects go: the model's nodes by game name (null until the model is loaded). */
  protected effectHost(): TimelineHost | null {
    return null;
  }

  /** Named effect points (Eff_Body, ...) of this kind of model. */
  protected effectDummies(): Promise<EffectDummy[]> {
    return Promise.resolve([]);
  }

  private clearSkill() {
    for (const player of this.skillEffects?.players ?? []) player.dispose();
    this.skillEffects = null;
  }

  private async loadSkill() {
    const ref = this.skill;
    const host = this.effectHost();
    const gen = ++this.skillGen;
    this.clearSkill();
    if (!ref) {
      this.skillApplied = 'null';
      return;
    }
    // Without a model yet, try again on the next render.
    if (!host) return;
    this.skillApplied = JSON.stringify(ref);
    try {
      const [record, dummies] = await Promise.all([fetchSkill(ref.id), this.effectDummies()]);
      const motion = record?.motions[ref.motion];
      if (!motion || gen !== this.skillGen || this.disposed) return;
      const timelines = await Promise.all(
        [motion.cast, motion.loop].flatMap((path) => (path ? [fetchTimeline(path)] : []))
      );
      // A model without the skill's clip shows its effects on whatever it plays.
      const hasClip = !!(await this.loadClip(motion.clip).catch(() => undefined));
      if (gen !== this.skillGen || this.disposed) return;
      this.skillEffects = {
        clip: hasClip ? motion.clip.toLowerCase() : null,
        players: timelines.flatMap((t) => (t ? [new TimelinePlayer(t, host, { dummies })] : []))
      };
    } catch (error) {
      this.context?.error(`Could not load the effects of ${ref.name}`, error);
    }
  }

  /** Skill effects follow the clip's own time (so they loop, pause and scrub with it); hidden on other clips. */
  protected updateSkillEffects() {
    // A skill set before the model finished loading starts once it has.
    if (this.skill && this.skillApplied !== JSON.stringify(this.skill) && this.effectHost()) void this.loadSkill();
    const effects = this.skillEffects;
    if (!effects) return;
    const playing = effects.clip === null || this.player?.clip?.name.toLowerCase() === effects.clip;
    const time = playing ? (this.player?.time ?? 0) : -1;
    for (const player of effects.players) player.update(time);
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
    this.updateSkillEffects();
  }

  protected clearPlayer() {
    this.clearSkill();
    this.skillApplied = undefined;
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
