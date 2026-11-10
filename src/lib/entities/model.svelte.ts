import { z } from 'zod';
import type { AnimationClip, Object3D } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { embeddedClips } from '../assets/clips.js';
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
  get glb() {
    return this.modelProperty.value;
  }
  private source: string | undefined;
  private content: Object3D | null = null;
  private embedded: AnimationClip[] = [];

  render(context: RenderContext) {
    super.render(context);
    if (this.source !== this.glb) {
      this.source = this.glb;
      void this.loadModel();
    }
  }

  protected async loadClip(name: string) {
    return this.embedded.find((clip) => clip.name === name);
  }

  /** Drop what was loaded; the next render() loads the model again. */
  protected unloadModel() {
    this.gen++;
    this.source = undefined;
    this.clearPlayer();
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
      this.ready(embeddedClips(loaded.animations));
    } catch (error) {
      this.context?.error(`Failed to load ${this.name}`, error);
    }
  }
}

export class NpcEntity extends ModelEntity {
  readonly type = 'npc';
}
