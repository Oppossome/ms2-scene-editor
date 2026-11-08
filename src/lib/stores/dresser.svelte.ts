import { AnimationPlayer } from '../assets/animation.js';
import { loadClips } from '../assets/loader.js';
import { bodyClipDir } from '../assets/urls.js';
import { getPalette, SKIN_PALETTE } from '../character/build.js';
import { CharacterRig } from '../character/rig.js';
import { paletteToTint } from '../character/tint.js';
import type { ItemRecord, PaletteColor } from '../types.js';
import type { OutfitSnapshot } from './outfits.js';

const DEFAULT_SKIN = 2;

/** State of the character dresser: the rig, what it wears and what it plays. */
export class DresserState {
  gender = $state<0 | 1>(1);
  rig = $state.raw<CharacterRig | null>(null);
  /** Reactive mirror of rig.equipped (items by slot order of equip). */
  worn = $state.raw<ItemRecord[]>([]);
  loading = $state(false);
  error = $state('');
  clipNames = $state.raw<string[]>([]);
  clipName = $state('');
  playing = $state(false);
  frameToken = $state(0);
  skinIndex = $state(DEFAULT_SKIN);
  skinColors = $state.raw<PaletteColor[]>([]);
  /** Chosen palette colour (colorSN) per item id; falls back to the item's default. */
  colorChoice = $state<Record<string, number>>({});
  palettes = $state.raw<Record<number, PaletteColor[]>>({});

  player: AnimationPlayer | null = null;
  private generation = 0;

  async load(gender: 0 | 1, keep: ItemRecord[] = []) {
    const gen = ++this.generation;
    this.loading = true;
    this.error = '';
    try {
      this.skinColors = await getPalette(SKIN_PALETTE);
      const skin = this.skinColors[this.skinIndex];
      const rig = await CharacterRig.create(gender, skin ? paletteToTint(skin) : undefined);
      if (gen !== this.generation) {
        rig.dispose();
        return;
      }
      this.player?.dispose();
      this.rig?.dispose();
      this.gender = gender;
      this.rig = rig;
      this.player = new AnimationPlayer(rig.root);
      this.playing = false;
      this.clipName = '';
      rig.onChange = () => (this.worn = [...rig.equipped.values()].map((e) => e.item));
      this.worn = [];
      this.frameToken++;
      void this.loadClipNames(gender);
      for (const item of keep) await this.equip(item).catch(() => undefined);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === this.generation) this.loading = false;
    }
  }

  async setGender(gender: 0 | 1) {
    if (gender === this.gender && this.rig) return;
    // Keep what fits: items are re-equipped when they have a model for the new gender.
    await this.load(gender, this.worn);
  }

  /** Palette colours an item can use (empty when it is not customisable). */
  async paletteOf(item: ItemRecord): Promise<PaletteColor[]> {
    if (!item.palette) return [];
    const colors = await getPalette(item.palette);
    if (!this.palettes[item.palette]) this.palettes = { ...this.palettes, [item.palette]: colors };
    return colors;
  }

  colorIndexOf(item: ItemRecord) {
    return this.colorChoice[item.id] ?? item.defaultColor;
  }

  async equip(item: ItemRecord) {
    if (!this.rig) return;
    try {
      this.error = '';
      const colors = await this.paletteOf(item);
      const chosen = colors[this.colorIndexOf(item)] ?? colors[0];
      await this.rig.equip(item, chosen ? paletteToTint(chosen) : undefined);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  unequip(itemId: string) {
    this.rig?.unequip(itemId);
  }

  clearAll() {
    for (const id of [...(this.rig?.equipped.keys() ?? [])]) this.rig?.unequip(id);
  }

  setItemColor(item: ItemRecord, sn: number) {
    this.colorChoice = { ...this.colorChoice, [item.id]: sn };
    const color = this.palettes[item.palette]?.[sn];
    if (color) this.rig?.setItemColors(item.id, paletteToTint(color));
  }

  setSkin(sn: number) {
    this.skinIndex = sn;
    const color = this.skinColors[sn];
    if (color) this.rig?.setSkinColors(paletteToTint(color));
  }

  snapshot(): OutfitSnapshot {
    return {
      version: 1,
      gender: this.gender,
      skin: this.skinIndex,
      items: this.worn.map((i) => ({ id: i.id, ...(this.colorChoice[i.id] !== undefined ? { color: this.colorChoice[i.id] } : {}) }))
    };
  }

  /** Rebuild the character from a saved outfit; items that no longer exist are skipped. */
  async restore(snap: OutfitSnapshot) {
    const records = await Promise.all(
      snap.items.map((entry) =>
        fetch(`/api/items/${entry.id}`)
          .then((r) => (r.ok ? (r.json() as Promise<ItemRecord>) : null))
          .catch(() => null)
      )
    );
    const choice: Record<string, number> = {};
    snap.items.forEach((entry) => {
      if (entry.color !== undefined) choice[entry.id] = entry.color;
    });
    this.colorChoice = choice;
    this.skinIndex = snap.skin;
    await this.load(snap.gender, records.filter((r): r is ItemRecord => !!r));
  }

  private async loadClipNames(gender: 0 | 1) {
    try {
      const res = await fetch(`/api/clips?gender=${gender}`);
      if (res.ok && gender === this.gender) this.clipNames = await res.json();
    } catch {
      this.clipNames = [];
    }
  }

  async play(name: string) {
    if (!this.player) return;
    if (!name) {
      this.player.stop();
      this.playing = false;
      this.clipName = '';
      return;
    }
    try {
      const clips = await loadClips(`${bodyClipDir(this.gender)}/${name}.glb`);
      if (clips[0]) {
        this.player.play(clips[0], true);
        this.clipName = name;
        this.playing = true;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  togglePlay() {
    if (!this.player?.clip) return;
    if (this.playing) this.player.pause();
    else this.player.resume();
    this.playing = !this.playing;
  }
}
