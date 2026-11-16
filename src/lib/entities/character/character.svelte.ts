import { z } from 'zod';
import { AnimationPlayer } from '../../assets/animation.js';
import { fetchBodyClips } from '../../assets/clips.js';
import { loadClips } from '../../assets/loader.js';
import { loadUserTexture } from '../../assets/user-textures.js';
import type { Texture } from 'three';
import { bodyClipDir } from '../../assets/urls.js';
import { eyeTint, getItem, itemTint, skinTint } from './build.js';
import { CharacterRig } from './rig.js';
import { FACE_OVERRIDES } from './expressions.js';
import { DEFAULT_EYE, DEFAULT_SKIN, SKIN_PALETTE, EYE_PALETTE } from './appearance.js';
import { expressionSchema } from './schemas.js';
import type { OutfitSnapshot } from './outfits.js';
import type { ItemEntity } from './item.svelte.js';
import { RiggedModel } from '../rigged-model.svelte.js';
import { fetchPlayerDummies, fetchTimeline, TimelinePlayer } from '../../assets/effects/timeline.js';
import { FRAME_RATE } from '../../assets/frames.js';
import type { ItemRecord } from '../../types.js';
import { EntityProperty } from '../property.svelte.js';
import type { RenderContext } from '../render-context.js';
import { indexSchema, omitUndefined } from '../validation.js';

const title = (value: string) => value[0].toUpperCase() + value.slice(1);

export class CharacterEntity extends RiggedModel {
  readonly type = 'character';
  readonly genderProperty = this.define(
    'gender',
    new EntityProperty(
      z.union([z.literal(0), z.literal(1)]),
      1,
      (value) => ({
        key: 'gender',
        label: 'Gender',
        section: 'Appearance',
        type: 'enum',
        value: String(value),
        options: [
          { value: '1', label: 'Female' },
          { value: '0', label: 'Male' }
        ],
        edit: (gender) => ({ gender: gender === '0' ? 0 : 1 })
      }),
      true
    )
  );
  readonly expressionProperty = this.define(
    'expression',
    new EntityProperty(expressionSchema.optional(), undefined, (value) => ({
      key: 'expression',
      label: 'Expression',
      section: 'Appearance',
      type: 'enum',
      value: value ?? '',
      options: [
        { value: '', label: 'Automatic (animation)' },
        ...FACE_OVERRIDES.map((name) => ({ value: name, label: title(name) }))
      ],
      edit: (name) => ({ expression: name || undefined })
    }))
  );
  readonly skinProperty = this.define(
    'skin',
    new EntityProperty(indexSchema, DEFAULT_SKIN, (value) => ({
      key: 'skin',
      label: 'Skin tone',
      section: 'Appearance',
      type: 'palette',
      value,
      palette: SKIN_PALETTE,
      edit: (skin) => ({ skin })
    }))
  );
  readonly eyeProperty = this.define(
    'eye',
    new EntityProperty(indexSchema, DEFAULT_EYE, (value) => ({
      key: 'eye',
      label: 'Eye colour',
      section: 'Appearance',
      type: 'palette',
      value,
      palette: EYE_PALETTE,
      channel: 0,
      edit: (eye) => ({ eye })
    }))
  );
  readonly effectsProperty = this.define(
    'effects',
    // Saved only when switched off, so characters saved before effects existed keep their JSON.
    new EntityProperty(z.boolean().optional(), undefined, (value) => ({
      key: 'effects',
      label: 'Item effects',
      section: 'Appearance',
      type: 'bool',
      value: value !== false,
      edit: (on) => ({ effects: on ? undefined : false })
    }))
  );
  get gender() {
    return this.genderProperty.value;
  }
  get skin() {
    return this.skinProperty.value;
  }
  get eye() {
    return this.eyeProperty.value;
  }
  get expression() {
    return this.expressionProperty.value;
  }

  rig: CharacterRig | null = null;
  private genderApplied: number | undefined;
  private skinApplied: number | undefined;
  private eyeApplied: number | undefined;
  private appearanceGen = 0;
  private itemSig = '';
  private itemColors = new Map<string, string>();
  /** The texture overrides shown on each worn item (as JSON), so unchanged ones are not applied again. */
  private itemTextures = new Map<string, string>();
  private reconciling = false;
  private dirty = false;
  /** Idle effects of worn items (their characterIdle XML, or characterBattleIdle with weapons drawn). */
  private readonly itemEffects = new Map<string, { path: string; player: TimelinePlayer | null }>();
  private effectsDrawn: boolean | undefined;
  private effectGen = 0;
  private effectTime = 0;

  render(context: RenderContext) {
    super.render(context);
    if (this.genderApplied !== this.gender) {
      this.genderApplied = this.gender;
      void this.loadRig();
    }
    if (this.rig && (this.skinApplied !== this.skin || this.eyeApplied !== this.eye)) void this.applyAppearance();
    this.updateFace();
    this.syncItems();
    if (this.rig) void this.syncEffects();
  }

  private async loadRig() {
    const gen = ++this.gen;
    this.clearPlayer();
    this.clearEffects();
    this.rig?.dispose();
    this.rig = null;
    for (const item of this.context?.items(this.id) ?? []) item.resetMount();
    this.itemSig = '';
    this.itemColors.clear();
    this.itemTextures.clear();
    try {
      const rig = await CharacterRig.create(this.gender, await skinTint(this.skin), await eyeTint(this.eye));
      if (gen !== this.gen || this.disposed) return rig.dispose();
      this.rig = rig;
      this.skinApplied = this.skin;
      this.eyeApplied = this.eye;
      this.object!.add(rig.root);
      this.context?.tag(rig.root, this.id);
      this.player = new AnimationPlayer(rig.root);
      const clips = await fetchBodyClips(rig.gender);
      if (gen !== this.gen || this.disposed) return;
      this.syncItems();
      this.ready(clips);
    } catch (error) {
      this.context?.error(`Failed to load ${this.name}`, error);
    }
  }

  private async applyAppearance() {
    const rig = this.rig;
    const gen = ++this.appearanceGen;
    this.skinApplied = this.skin;
    this.eyeApplied = this.eye;
    try {
      const [skin, eye] = await Promise.all([skinTint(this.skin), eyeTint(this.eye)]);
      if (gen !== this.appearanceGen || rig !== this.rig || this.disposed) return;
      if (skin) rig?.setSkinColors(skin);
      if (eye) rig?.setEyeColors(eye);
    } catch (error) {
      this.context?.error(`Could not colour ${this.name}`, error);
    }
  }

  protected async loadClip(name: string) {
    return (await loadClips(`${bodyClipDir(this.gender)}/${name}.glb`))[0];
  }

  /** Faces follow the clip's face sequence, weapons are held during combat clips. */
  private updateFace() {
    this.rig?.followClip(this.player?.clip?.name ?? '', this.player?.time ?? 0, this.expression);
  }

  tick(delta: number) {
    super.tick(delta);
    this.updateFace();
    if (!this.itemEffects.size) return;
    if (this.rig && this.rig.weaponsDrawn !== this.effectsDrawn) void this.syncEffects();
    // A held frame holds the effects; otherwise they run on their own clock (idle auras loop).
    if (this.freeze === undefined) this.effectTime += delta * (this.speed ?? 1);
    const time = this.freeze === undefined ? this.effectTime : this.freeze / FRAME_RATE;
    for (const effect of this.itemEffects.values()) effect.player?.update(time);
  }

  protected effectHost() {
    const rig = this.rig;
    return rig ? { root: rig.node('Scene Root') ?? rig.root, node: (name: string) => rig.node(name) } : null;
  }

  protected effectDummies() {
    return fetchPlayerDummies(this.gender);
  }

  private clearEffects() {
    this.effectGen++;
    for (const effect of this.itemEffects.values()) effect.player?.dispose();
    this.itemEffects.clear();
    this.effectsDrawn = undefined;
  }

  /** Play the idle effects of what the character wears (none when effects are switched off). */
  private async syncEffects() {
    const rig = this.rig;
    if (!rig) return;
    const gen = ++this.effectGen;
    this.effectsDrawn = rig.weaponsDrawn;
    const wanted = new Map<string, string>();
    if (this.effectsProperty.value !== false) {
      const records = await Promise.all(
        (this.context?.items(this.id) ?? []).filter((i) => i.visible).map((i) => getItem(i.itemId))
      );
      if (gen !== this.effectGen || rig !== this.rig || this.disposed) return;
      for (const record of records) {
        const path = itemEffectPath(record, rig.weaponsDrawn);
        if (record && path) wanted.set(record.id, path);
      }
    }
    for (const [id, effect] of this.itemEffects)
      if (wanted.get(id) !== effect.path) {
        effect.player?.dispose();
        this.itemEffects.delete(id);
      }
    const host = this.effectHost()!;
    for (const [id, path] of wanted) {
      if (this.itemEffects.has(id)) continue;
      const effect: { path: string; player: TimelinePlayer | null } = { path, player: null };
      this.itemEffects.set(id, effect);
      try {
        const [timeline, dummies] = await Promise.all([fetchTimeline(path), fetchPlayerDummies(rig.gender)]);
        if (gen !== this.effectGen || this.itemEffects.get(id) !== effect || !timeline) continue;
        effect.player = new TimelinePlayer(timeline, host, { dummies, seed: 1 });
      } catch (error) {
        this.context?.error(`Could not load the effect ${path}`, error);
      }
    }
    this.context?.changed();
  }

  /** Apply what is cheap (offsets, visibility, bones) and reconcile the worn set when it changed. */
  syncItems() {
    if (!this.rig) return;
    const items = this.context?.items(this.id) ?? [];
    for (const item of items) item.renderOn(this);
    const signature = items
      .map(
        (item) =>
          `${item.id}:${item.itemId}:${item.color}:${JSON.stringify(item.channelColors)}:${JSON.stringify(item.textures)}`
      )
      .join('|');
    if (signature === this.itemSig) return;
    this.itemSig = signature;
    if (this.reconciling) {
      this.dirty = true;
      return;
    }
    this.reconciling = true;
    void this.reconcileLoop();
  }

  private async reconcileLoop() {
    try {
      do {
        this.dirty = false;
        await this.reconcile();
      } while (this.dirty && !this.disposed);
    } catch (error) {
      this.context?.error(`Could not dress ${this.name}`, error);
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Show the item's texture overrides (the user's images, kept in the browser). An image this browser does not have
   * is reported and the item keeps its own texture there. False when the character changed meanwhile.
   */
  private async applyTextures(rig: CharacterRig, item: ItemEntity, gen: number): Promise<boolean> {
    const id = item.itemId;
    const key = JSON.stringify(item.textures ?? {});
    if (this.itemTextures.get(id) === key) return true;
    const images = new Map<string, Texture>();
    await Promise.all(
      Object.entries(item.textures ?? {}).map(async ([name, textureId]) => {
        try {
          images.set(name, await loadUserTexture(textureId));
        } catch (error) {
          this.context?.error(`Could not show ${name} on ${item.name}`, error);
        }
      })
    );
    if (gen !== this.gen || this.disposed) return false;
    rig.setItemTextures(id, images);
    this.itemTextures.set(id, key);
    return true;
  }

  /** Make the rig wear exactly the item children of this character. */
  private async reconcile() {
    const rig = this.rig;
    const gen = this.gen;
    if (!rig) return;
    const desired = this.context?.items(this.id) ?? [];
    const wanted = new Set(desired.map((item) => item.itemId));
    for (const id of [...rig.equipped.keys()]) if (!wanted.has(id)) rig.unequip(id);
    for (const item of desired) {
      if (gen !== this.gen || this.disposed) return;
      const id = item.itemId;
      const key = `${item.color}:${JSON.stringify(item.channelColors)}`;
      const worn = rig.isEquipped(id);
      if (!worn || this.itemColors.get(id) !== key) {
        const record = await getItem(id);
        if (!record) throw new Error(`Missing item ${id}`);
        const colors = await itemTint(record, item.color, item.channelColors);
        if (gen !== this.gen || this.disposed) return;
        if (worn) {
          if (colors) rig.setItemColors(id, colors);
        } else {
          await rig.equip(record, colors);
          // A fresh model shows its own textures until the overrides are applied to it.
          this.itemTextures.delete(id);
        }
        if (gen !== this.gen || this.disposed) return;
        this.itemColors.set(id, key);
      }
      if (!(await this.applyTextures(rig, item, gen))) return;
    }
    if (gen !== this.gen || this.disposed) return;
    for (const item of this.context?.items(this.id) ?? []) {
      item.resetMount();
      for (const object of rig.objectsOf(item.itemId)) this.context?.tag(object, item.id);
      item.renderOn(this);
    }
    this.updateFace();
    void this.syncEffects();
    this.context?.reparent();
    this.context?.changed();
  }

  /** What this character wears, as a reusable preset (not scene state). */
  captureOutfit(items: readonly ItemEntity[]): OutfitSnapshot {
    return {
      version: 1,
      gender: this.gender,
      skin: this.skin,
      eye: this.eye,
      ...(this.expression ? { expression: this.expression } : {}),
      items: items.map((item) =>
        omitUndefined({
          id: item.itemId,
          color: item.color,
          channels: item.channelColors,
          hold: item.hold,
          textures: item.textures
        })
      )
    };
  }

  dispose() {
    this.clearEffects();
    this.rig?.dispose();
    this.rig = null;
    super.dispose();
  }
}

/** The idle effect a worn item shows on its character: the battle one while weapons are drawn, when it has one. */
export function itemEffectPath(record: ItemRecord | null | undefined, drawn: boolean): string | undefined {
  const effects = record?.effects;
  if (!effects) return undefined;
  return (drawn ? effects.characterBattleIdle : undefined) ?? effects.characterIdle;
}
