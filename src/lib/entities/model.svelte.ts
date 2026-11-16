import { z } from 'zod';
import { PropertyBinding, type AnimationClip, type Object3D } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { embeddedClips } from '../assets/clips.js';
import { EffectPlayer, hasEffects, uriResolver } from '../assets/effects/player.js';
import { FRAME_RATE } from '../assets/frames.js';
import { fetchTimeline, TimelinePlayer } from '../assets/effects/timeline.js';
import { instantiate } from '../assets/loader.js';
import { RiggedModel } from './rigged-model.svelte.js';
import { EntityProperty } from './property.svelte.js';
import type { RenderContext } from './render-context.js';

const text = z.string();

/** A model loaded from a converted GLB. */
export abstract class ModelEntity extends RiggedModel {
  readonly modelProperty = this.define(
    'glb',
    new EntityProperty(
      text.min(1),
      '',
      (value) => ({
        key: 'glb',
        label: 'Model',
        section: 'Source',
        type: 'readonly',
        value
      }),
      true
    )
  );
  /** An effect XML the model always shows (an NPC's keep effect), played on its nodes. */
  readonly effectProperty = this.define(
    'effect',
    new EntityProperty(text.min(1).optional(), undefined, (value) =>
      value ? { key: 'effect', label: 'Effect', section: 'Source', type: 'readonly', value } : null
    )
  );
  get glb() {
    return this.modelProperty.value;
  }
  private source: string | undefined;
  private content: Object3D | null = null;
  private embedded: AnimationClip[] = [];
  /** Billboards, particles and animated materials in the model, on their own clock. */
  effects: EffectPlayer | null = null;
  private timeline: TimelinePlayer | null = null;
  private timelineSource: string | undefined;
  private effectTime = 0;

  render(context: RenderContext) {
    super.render(context);
    if (this.source !== this.glb) {
      this.source = this.glb;
      void this.loadModel();
    }
    if (this.content && this.timelineSource !== this.effectProperty.value) void this.loadTimeline();
  }

  protected async loadClip(name: string) {
    return this.embedded.find((clip) => clip.name === name);
  }

  /** Drop what was loaded; the next render() loads the model again. */
  protected unloadModel() {
    this.gen++;
    this.source = undefined;
    this.clearPlayer();
    this.effects?.dispose();
    this.effects = null;
    this.timeline?.dispose();
    this.timeline = null;
    this.timelineSource = undefined;
    this.content?.removeFromParent();
    this.content = null;
    this.embedded = [];
  }

  private async loadModel() {
    this.unloadModel();
    const gen = this.gen;
    this.source = this.glb;
    try {
      const loaded = await instantiate(this.glb);
      if (this.disposed || gen !== this.gen) return;
      this.content = loaded.object;
      this.embedded = loaded.animations;
      this.object!.add(loaded.object);
      this.player = new AnimationPlayer(loaded.object);
      if (hasEffects(loaded.object)) {
        this.effects = new EffectPlayer(loaded.object, { seed: seedOf(this.id) }, uriResolver(loaded.object));
        this.effectTime = 0;
        this.effects.update(0);
      }
      this.ready(embeddedClips(loaded.animations));
      void this.loadTimeline();
    } catch (error) {
      this.context?.error(`Failed to load ${this.name}`, error);
    }
  }

  protected effectHost() {
    const content = this.content;
    if (!content) return null;
    const node = (name: string) => content.getObjectByName(PropertyBinding.sanitizeNodeName(name));
    return { root: node('Scene Root') ?? content, node };
  }

  /** Play the model's effect XML on its own nodes (bones and dummies by their game names). */
  private async loadTimeline() {
    const path = this.effectProperty.value;
    const content = this.content;
    this.timelineSource = path;
    this.timeline?.dispose();
    this.timeline = null;
    if (!path || !content) return;
    try {
      const timeline = await fetchTimeline(path);
      if (!timeline || this.content !== content || this.timelineSource !== path || this.disposed) return;
      const host = this.effectHost();
      if (host) this.timeline = new TimelinePlayer(timeline, host);
    } catch (error) {
      this.context?.error(`Could not load the effect ${path}`, error);
    }
  }

  tick(delta: number) {
    super.tick(delta);
    if (!this.effects && !this.timeline) return;
    // A held frame holds the effects too; otherwise they run on, so looping emitters never restart.
    if (this.freeze === undefined) this.effectTime += delta * (this.speed ?? 1);
    const time = this.freeze === undefined ? this.effectTime : this.freeze / FRAME_RATE;
    this.effects?.update(time);
    this.timeline?.update(time);
  }
}

/** A stable particle seed per entity, so copies of a prop do not emit in lockstep. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 1;
}

export class NpcEntity extends ModelEntity {
  readonly type = 'npc';
}
