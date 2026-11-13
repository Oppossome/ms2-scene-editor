import type { Object3D } from 'three';
import { restoreEntity } from '../../entities/registry.js';
import { RiggedModel } from '../../entities/rigged-model.svelte.js';
import type { Entity } from '../../entities/types.js';
import { buildMap, type BuiltMap } from '../../maps/instancing.js';
import { SceneRuntime } from '../../scene/runtime.svelte.js';
import type { ClipInfo, MapData, MapEnvironment } from '../../types.js';
import { previewEntities, type EntitySource } from './entities.js';

/** What the preview pane shows. */
export type PreviewSource = EntitySource | { kind: 'map'; id: string };

/**
 * Loads one thing at a time into an object the preview stage draws, with its animation and status. Models,
 * characters and items are scene entities in a small scene of the preview's own, so they render, dress and animate
 * exactly as in the scene. A newer `show` supersedes an older one (a late result is thrown away); `dispose`
 * releases everything.
 */
export class PreviewController {
  /** What was last asked to be shown (null: nothing), so a clip picker can preview the same thing on its own. */
  source = $state.raw<PreviewSource | null>(null);
  object = $state.raw<Object3D | null>(null);
  /** Bump to re-frame the camera. */
  frameToken = $state(0);
  status = $state('');
  failed = $state(false);
  /** Map loading progress and facts. */
  progress = $state.raw<{ loaded: number; total: number } | null>(null);
  facts = $state('');
  /** Whether the thing is a map (no ground grid, bigger scale). */
  isMap = $state(false);
  /** Backdrop and fog of a previewed map. */
  environment = $state.raw<MapEnvironment | null>(null);

  clip = $state('');
  playing = $state(false);
  loop = $state(true);

  private gen = 0;
  private runtime = $state.raw<SceneRuntime | null>(null);
  /** The entity whose clips play: the model or the character. */
  private main = $state.raw<RiggedModel | null>(null);
  private entities: Entity[] = [];
  private framed = false;
  private map: BuiltMap | null = null;

  get clips(): ClipInfo[] {
    return this.main && this.runtime ? this.runtime.clipsOf(this.main.id) : [];
  }

  /** Show a source, or nothing for null. */
  async show(source: PreviewSource | null) {
    const gen = ++this.gen;
    this.release();
    this.source = source;
    if (!source) return;
    this.status = 'Loading...';
    try {
      if (source.kind === 'map') await this.showMap(source, gen);
      else await this.showEntities(source, gen);
    } catch (e) {
      if (gen !== this.gen) return;
      this.object = null;
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private fail(message: string) {
    this.failed = true;
    this.status = message;
  }

  private async showEntities(source: EntitySource, gen: number) {
    const json = await previewEntities(source);
    if (gen !== this.gen) return;
    const entities = json.map((input) => restoreEntity(input));
    const main = entities[0];
    if (!(main instanceof RiggedModel)) throw new Error('Nothing to preview');
    const runtime = new SceneRuntime();
    runtime.hooks = {
      // A model without a clip gets its idle one, as in the scene.
      defaultClip: (id, clip) => {
        if (gen === this.gen && id === main.id) void this.play(clip);
      },
      error: (message) => {
        if (gen === this.gen) this.fail(message);
      }
    };
    main.loop = this.loop;
    this.entities = entities;
    this.main = main;
    this.runtime = runtime;
    this.clip = main.clip ?? '';
    this.playing = !!main.clip;
    runtime.sync(entities);
    this.object = runtime.root;
  }

  private async showMap(s: { id: string }, gen: number) {
    this.isMap = true;
    const res = await fetch(`/api/maps/${s.id}`);
    if (!res.ok) throw new Error(`Map ${s.id}: ${res.status}`);
    const data = (await res.json()) as MapData;
    if (gen !== this.gen) return;
    this.facts =
      `${data.items.length.toLocaleString()} props, ${data.models.length.toLocaleString()} models` +
      (data.unresolved ? `, ${data.unresolved.toLocaleString()} entities without a model` : '');
    this.environment = data.environment ?? null;
    this.progress = { loaded: 0, total: data.models.length };
    let failed = 0;
    const built = buildMap(data, {
      onProgress: (p) => {
        if (gen !== this.gen) return;
        failed = p.failed;
        this.progress = { loaded: p.modelsLoaded, total: p.modelsTotal };
        // Frame the view once a first batch of models is in.
        if (p.modelsLoaded === Math.min(8, p.modelsTotal)) this.frameToken++;
      },
      cancelled: () => gen !== this.gen
    });
    this.map = built;
    this.object = built.group;
    this.status = '';
    await built.done;
    if (gen !== this.gen) return;
    this.frameToken++;
    this.progress = null;
    if (failed) this.status = `${failed} models failed to load`;
  }

  /** Play a clip of the model or character ('' stops). */
  async play(name: string) {
    const main = this.main;
    if (!main || !this.runtime) return;
    main.loop = this.loop;
    main.set({ clip: name || undefined, freeze: undefined });
    this.runtime.sync(this.entities);
    this.clip = name;
    this.playing = !!name;
  }

  togglePlay() {
    const player = this.main?.player;
    if (!player?.clip) return;
    if (this.playing) player.pause();
    else player.resume();
    this.playing = !this.playing;
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    if (!this.main) return;
    this.main.loop = loop;
    if (this.clip) {
      void this.main.playClip();
      this.playing = true;
    }
  }

  /** Call every frame. */
  update(delta: number) {
    const runtime = this.runtime;
    if (!runtime || !this.main) return;
    runtime.update(delta);
    // Frame the camera once the model (or the body) is in.
    if (!this.framed && runtime.boundsOf(this.main.id)) {
      this.framed = true;
      this.frameToken++;
      if (!this.failed) this.status = '';
    }
  }

  private release() {
    this.runtime?.dispose();
    this.runtime = null;
    this.main = null;
    this.entities = [];
    this.framed = false;
    this.map?.dispose();
    this.map = null;
    this.object = null;
    this.status = '';
    this.failed = false;
    this.progress = null;
    this.facts = '';
    this.isMap = false;
    this.environment = null;
    this.clip = '';
    this.playing = false;
  }

  dispose() {
    this.gen++;
    this.release();
  }
}
