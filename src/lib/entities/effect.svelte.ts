import { z } from 'zod';
import { Color, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D } from 'three';
import { instantiate } from '../assets/loader.js';
import { EffectPlayer, uriResolver } from '../assets/effects/player.js';
import { BaseEntity } from './base.svelte.js';
import { EntityProperty, type PropContext, type PropertyControl } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { finite } from './validation.js';

const color = z.tuple([finite.min(0).max(255), finite.min(0).max(255), finite.min(0).max(255)]);

/** Selection handle for effects whose particles have no geometry to click. Never drawn. */
const proxyGeometry = new SphereGeometry(25, 8, 6);
const proxyMaterial = new MeshBasicMaterial({ visible: false });

/**
 * A game effect (a converted effect NIF): its meshes, billboards, animated materials and particle systems, played on
 * the entity's own clock. Particles are simulated from the seed, so a save only keeps the settings.
 */
export class EffectEntity extends BaseEntity {
  readonly type = 'effect';
  readonly modelProperty = this.define(
    'glb',
    new EntityProperty(
      z.string().min(1),
      '',
      (value) => ({ key: 'glb', label: 'Effect', section: 'Source', type: 'readonly', value }),
      true
    )
  );
  readonly loopProperty = this.define(
    'loop',
    new EntityProperty(z.boolean(), true, (value) => ({
      key: 'loop',
      label: 'Loop',
      section: 'Effect',
      type: 'bool',
      value,
      edit: (loop) => ({ loop })
    }))
  );
  readonly speedProperty = this.define(
    'speed',
    new EntityProperty(finite.positive(), 1, (value) => ({
      key: 'speed',
      label: 'Speed',
      section: 'Effect',
      type: 'number',
      value,
      step: 0.1,
      min: 0.05,
      edit: (speed) => ({ speed })
    }))
  );
  readonly emissionProperty = this.define(
    'emission',
    new EntityProperty(finite.min(0).max(10), 1, (value) => ({
      key: 'emission',
      label: 'Emission',
      section: 'Effect',
      type: 'number',
      value,
      step: 0.1,
      min: 0,
      max: 10,
      edit: (emission) => ({ emission })
    }))
  );
  readonly sizeProperty = this.define(
    'particleSize',
    new EntityProperty(finite.positive().max(100), 1, (value) => ({
      key: 'particleSize',
      label: 'Particle size',
      section: 'Effect',
      type: 'number',
      value,
      step: 0.1,
      min: 0.01,
      edit: (particleSize) => ({ particleSize })
    }))
  );
  readonly tintProperty = this.define(
    'tint',
    new EntityProperty(color, [255, 255, 255] as [number, number, number], (value) => ({
      key: 'tint',
      label: 'Tint RGB',
      section: 'Effect',
      type: 'vec3',
      value,
      step: 1,
      min: 0,
      max: 255,
      edit: (tint) => ({ tint })
    }))
  );
  readonly seedProperty = this.define(
    'seed',
    new EntityProperty(
      z
        .number()
        .int()
        .min(0)
        .max(2 ** 31 - 1),
      1,
      (value) => ({
        key: 'seed',
        label: 'Seed',
        section: 'Effect',
        type: 'number',
        value,
        step: 1,
        min: 0,
        edit: (seed) => ({ seed: Math.round(seed) })
      })
    )
  );

  get glb() {
    return this.modelProperty.value;
  }
  get loop() {
    return this.loopProperty.value;
  }
  get speed() {
    return this.speedProperty.value;
  }

  player: EffectPlayer | null = null;
  /** Effect time in seconds (not saved). */
  time = 0;
  private source: string | undefined;
  private content: Object3D | null = null;
  private proxy: Mesh | null = null;
  private appliedLoop: boolean | undefined;
  private appliedSeed: number | undefined;

  controls(ctx: PropContext): PropertyControl[] {
    return [
      ...super.controls(ctx),
      {
        key: 'restart',
        label: 'Playback',
        section: 'Effect',
        type: 'action',
        value: 'Restart',
        // Restarting is not an edit; returning no change keeps it out of history.
        edit: () => {
          this.restart();
          return {};
        }
      }
    ];
  }

  restart() {
    this.time = 0;
    this.player?.restart();
  }

  render(context: RenderContext) {
    this.renderTransform(context);
    if (!this.proxy) {
      this.proxy = new Mesh(proxyGeometry, proxyMaterial);
      this.proxy.name = 'effect handle';
      this.proxy.userData.effectProxy = true;
      this.object!.add(this.proxy);
    }
    if (this.source !== this.glb) {
      this.source = this.glb;
      void this.load();
    }
    if (this.appliedLoop !== this.loop || this.appliedSeed !== this.seedProperty.value) {
      if (this.appliedLoop !== undefined) this.restart();
      this.appliedLoop = this.loop;
      this.appliedSeed = this.seedProperty.value;
    }
    this.player?.setOptions(this.options());
  }

  private options() {
    const [r, g, b] = this.tintProperty.value;
    return {
      seed: this.seedProperty.value,
      emissionScale: this.emissionProperty.value,
      sizeScale: this.sizeProperty.value,
      tint: new Color(r / 255, g / 255, b / 255)
    };
  }

  private unload() {
    this.gen++;
    this.player?.dispose();
    this.player = null;
    this.content?.removeFromParent();
    this.content = null;
  }

  private async load() {
    this.unload();
    const gen = this.gen;
    try {
      const loaded = await instantiate(this.glb);
      if (this.disposed || gen !== this.gen) return;
      this.content = loaded.object;
      this.object!.add(loaded.object);
      this.player = new EffectPlayer(loaded.object, this.options(), uriResolver(loaded.object));
      this.time = 0;
      this.player.update(0);
      this.context?.changed();
    } catch (error) {
      this.context?.error(`Failed to load ${this.name}`, error);
    }
  }

  /** The effect time to show for the clock: looping restarts one-shot effects after their last particle dies. */
  effectTime(): number {
    const player = this.player;
    if (!player) return this.time;
    const length = player.duration + player.particleTail;
    if (!this.loop) return Math.min(this.time, length);
    if (player.selfLooping || length <= 0) return this.time;
    return this.time % length;
  }

  tick(delta: number) {
    if (!this.player) return;
    this.time += delta * this.speed;
    this.player.update(this.effectTime());
  }

  dispose() {
    this.unload();
    this.proxy?.removeFromParent();
    this.proxy = null;
    super.dispose();
  }
}
