import type { AnimationClip, Object3D } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { instantiate, loadClips } from '../assets/loader.js';
import { bodyClipDir } from '../assets/urls.js';
import { getItem, itemTint, skinTint } from '../character/build.js';
import { CharacterRig } from '../character/rig.js';
import { buildMap, type BuiltMap } from '../maps/instancing.js';
import { DEFAULT_SKIN } from '../scene/model.js';
import type { ItemRecord, MapData } from '../types.js';

/** What the preview pane shows. */
export type PreviewSource =
  | { kind: 'model'; glb: string; scale?: number }
  | { kind: 'map'; id: string }
  | { kind: 'character'; gender: 0 | 1; skin?: number; items: { id: string; color?: number }[] }
  | {
      kind: 'item';
      item: ItemRecord;
      gender: 0 | 1;
      color?: number;
      /** The character the item is tried on (its skin and what it already wears); a bare body when omitted. */
      base?: { skin: number; items: { id: string; color?: number }[] };
    };

/**
 * Loads one thing at a time into an object the preview stage draws, with its animation and status. A newer
 * `show` supersedes an older one (a late result is thrown away); `dispose` releases everything.
 */
export class PreviewController {
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

  clipNames = $state.raw<string[]>([]);
  clip = $state('');
  playing = $state(false);
  loop = $state(true);

  private gen = 0;
  private player: AnimationPlayer | null = null;
  private rig: CharacterRig | null = null;
  private map: BuiltMap | null = null;
  private embedded: AnimationClip[] = [];
  private bodyGender: 0 | 1 | null = null;

  /** Show a source, or nothing for null. */
  async show(source: PreviewSource | null) {
    const gen = ++this.gen;
    this.release();
    if (!source) return;
    this.status = 'Loading...';
    try {
      switch (source.kind) {
        case 'model':
          await this.showModel(source, gen);
          break;
        case 'map':
          await this.showMap(source, gen);
          break;
        case 'character':
          await this.showCharacter(source, gen);
          break;
        case 'item':
          await this.showItem(source, gen);
          break;
      }
    } catch (e) {
      if (gen !== this.gen) return;
      this.object = null;
      this.failed = true;
      this.status = e instanceof Error ? e.message : String(e);
    }
  }

  private async showModel(s: Extract<PreviewSource, { kind: 'model' }>, gen: number) {
    const loaded = await instantiate(s.glb);
    if (gen !== this.gen) return;
    if (s.scale && s.scale !== 1) loaded.object.scale.setScalar(s.scale);
    this.embedded = loaded.animations;
    this.player = new AnimationPlayer(loaded.object);
    this.clipNames = loaded.animations.map((c) => c.name);
    this.object = loaded.object;
    this.frameToken++;
    this.status = '';
    const idle = this.clipNames.find((n) => /^idle/i.test(n)) ?? this.clipNames[0];
    if (idle) await this.play(idle);
  }

  private async showMap(s: Extract<PreviewSource, { kind: 'map' }>, gen: number) {
    this.isMap = true;
    const res = await fetch(`/api/maps/${s.id}`);
    if (!res.ok) throw new Error(`Map ${s.id}: ${res.status}`);
    const data = (await res.json()) as MapData;
    if (gen !== this.gen) return;
    this.facts =
      `${data.items.length.toLocaleString()} props, ${data.models.length.toLocaleString()} models` +
      (data.unresolved ? `, ${data.unresolved.toLocaleString()} entities without a model` : '');
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

  private async showCharacter(s: Extract<PreviewSource, { kind: 'character' }>, gen: number) {
    const rig = await CharacterRig.create(s.gender, await skinTint(s.skin ?? DEFAULT_SKIN));
    if (gen !== this.gen) return rig.dispose();
    this.attachRig(rig, s.gender);
    this.frameToken++;
    this.status = '';
    if (!(await this.wear(rig, s.items, gen))) return;
    void this.loadBodyClips(s.gender, gen, 'idle_a');
  }

  /** Put items on a rig in order; false when a newer `show` took over meanwhile. */
  private async wear(rig: CharacterRig, items: { id: string; color?: number }[], gen: number): Promise<boolean> {
    const records = await Promise.all(items.map((i) => getItem(i.id)));
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;
      if (gen !== this.gen) return false;
      await rig.equip(record, await itemTint(record, items[i].color)).catch(() => undefined);
    }
    return gen === this.gen;
  }

  private async showItem(s: Extract<PreviewSource, { kind: 'item' }>, gen: number) {
    const rig = await CharacterRig.create(s.gender, await skinTint(s.base?.skin ?? DEFAULT_SKIN));
    if (gen !== this.gen) return rig.dispose();
    this.attachRig(rig, s.gender);
    this.frameToken++;
    this.status = '';
    // What the character already wears first; the new item then replaces whatever shares its slot.
    if (s.base && !(await this.wear(rig, s.base.items, gen))) return;
    try {
      await rig.equip(s.item, await itemTint(s.item, s.color));
    } catch (e) {
      if (gen !== this.gen) return;
      this.failed = true;
      this.status = e instanceof Error ? e.message : String(e);
      return;
    }
    if (gen !== this.gen) return;
    void this.loadBodyClips(s.gender, gen, 'idle_a');
  }

  private attachRig(rig: CharacterRig, gender: 0 | 1) {
    this.rig = rig;
    this.bodyGender = gender;
    this.player = new AnimationPlayer(rig.root);
    this.object = rig.root;
  }

  private async loadBodyClips(gender: 0 | 1, gen: number, start: string) {
    try {
      const res = await fetch(`/api/clips?gender=${gender}`);
      if (!res.ok || gen !== this.gen) return;
      const names = (await res.json()) as string[];
      if (gen !== this.gen) return;
      this.clipNames = names;
      const first = names.includes(start) ? start : names.find((n) => /^idle/i.test(n));
      if (first) await this.play(first);
    } catch {
      // Without clips the pose just stays the bind pose.
    }
  }

  async play(name: string) {
    const player = this.player;
    if (!player) return;
    if (!name) {
      player.stop();
      this.playing = false;
      this.clip = '';
      return;
    }
    const gen = this.gen;
    let clip: AnimationClip | undefined;
    if (this.rig && this.bodyGender !== null) {
      clip = (await loadClips(`${bodyClipDir(this.bodyGender)}/${name}.glb`).catch(() => []))[0];
    } else {
      clip = this.embedded.find((c) => c.name === name);
    }
    if (gen !== this.gen || this.player !== player || !clip) return;
    player.play(clip, this.loop);
    this.clip = name;
    this.playing = true;
  }

  togglePlay() {
    if (!this.player?.clip) return;
    if (this.playing) this.player.pause();
    else this.player.resume();
    this.playing = !this.playing;
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    if (this.clip) void this.play(this.clip);
  }

  /** Call every frame. */
  update(delta: number) {
    this.player?.update(delta);
  }

  private release() {
    this.player?.dispose();
    this.player = null;
    this.rig?.dispose();
    this.rig = null;
    this.map?.dispose();
    this.map = null;
    this.bodyGender = null;
    this.embedded = [];
    this.object = null;
    this.status = '';
    this.failed = false;
    this.progress = null;
    this.facts = '';
    this.isMap = false;
    this.clipNames = [];
    this.clip = '';
    this.playing = false;
  }

  dispose() {
    this.gen++;
    this.release();
  }
}
