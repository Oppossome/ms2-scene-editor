import { z } from "zod";
import { AnimationPlayer } from "../../assets/animation.js";
import { fetchBodyClips } from "../../assets/clips.js";
import { loadClips } from "../../assets/loader.js";
import { bodyClipDir } from "../../assets/urls.js";
import { eyeTint, getItem, itemTint, skinTint } from "./build.js";
import { CharacterRig } from "./rig.js";
import { FACE_OVERRIDES } from "./expressions.js";
import {
  DEFAULT_EYE,
  DEFAULT_SKIN,
  SKIN_PALETTE,
  EYE_PALETTE,
} from "./appearance.js";
import { expressionSchema } from "./schemas.js";
import type { OutfitSnapshot } from "./outfits.js";
import type { ItemEntity } from "./item.svelte.js";
import { RiggedModel } from "../rigged-model.svelte.js";
import { EntityProperty } from "../property.svelte.js";
import type { RenderContext } from "../render-context.js";
import { indexSchema, omitUndefined } from "../validation.js";

const title = (value: string) => value[0].toUpperCase() + value.slice(1);

export class CharacterEntity extends RiggedModel {
  readonly type = "character";
  readonly genderProperty = this.define(
    "gender",
    new EntityProperty(
      z.union([z.literal(0), z.literal(1)]),
      1,
      (value) => ({
        key: "gender",
        label: "Gender",
        section: "Appearance",
        type: "enum",
        value: String(value),
        options: [
          { value: "1", label: "Female" },
          { value: "0", label: "Male" },
        ],
        edit: (gender) => ({ gender: gender === "0" ? 0 : 1 }),
      }),
      true,
    ),
  );
  readonly expressionProperty = this.define(
    "expression",
    new EntityProperty(expressionSchema.optional(), undefined, (value) => ({
      key: "expression",
      label: "Expression",
      section: "Appearance",
      type: "enum",
      value: value ?? "",
      options: [
        { value: "", label: "Automatic (animation)" },
        ...FACE_OVERRIDES.map((name) => ({ value: name, label: title(name) })),
      ],
      edit: (name) => ({ expression: name || undefined }),
    })),
  );
  readonly skinProperty = this.define(
    "skin",
    new EntityProperty(indexSchema, DEFAULT_SKIN, (value) => ({
      key: "skin",
      label: "Skin tone",
      section: "Appearance",
      type: "palette",
      value,
      palette: SKIN_PALETTE,
      edit: (skin) => ({ skin }),
    })),
  );
  readonly eyeProperty = this.define(
    "eye",
    new EntityProperty(indexSchema, DEFAULT_EYE, (value) => ({
      key: "eye",
      label: "Eye colour",
      section: "Appearance",
      type: "palette",
      value,
      palette: EYE_PALETTE,
      channel: 0,
      edit: (eye) => ({ eye }),
    })),
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
  private itemSig = "";
  private itemColors = new Map<string, string>();
  private reconciling = false;
  private dirty = false;

  render(context: RenderContext) {
    super.render(context);
    if (this.genderApplied !== this.gender) {
      this.genderApplied = this.gender;
      void this.loadRig();
    }
    if (
      this.rig &&
      (this.skinApplied !== this.skin || this.eyeApplied !== this.eye)
    )
      void this.applyAppearance();
    this.updateFace();
    this.syncItems();
  }

  private async loadRig() {
    const gen = ++this.gen;
    this.clearPlayer();
    this.rig?.dispose();
    this.rig = null;
    for (const item of this.context?.items(this.id) ?? []) item.resetMount();
    this.itemSig = "";
    this.itemColors.clear();
    try {
      const rig = await CharacterRig.create(
        this.gender,
        await skinTint(this.skin),
        await eyeTint(this.eye),
      );
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
      const [skin, eye] = await Promise.all([
        skinTint(this.skin),
        eyeTint(this.eye),
      ]);
      if (gen !== this.appearanceGen || rig !== this.rig || this.disposed)
        return;
      if (skin) rig?.setSkinColors(skin);
      if (eye) rig?.setEyeColors(eye);
    } catch (error) {
      this.context?.error(`Could not colour ${this.name}`, error);
    }
  }

  protected async loadClip(name: string) {
    return (await loadClips(`${bodyClipDir(this.gender)}/${name}.glb`))[0];
  }

  private updateFace() {
    this.rig?.updateFace(
      this.player?.clip?.name ?? "",
      this.player?.time ?? 0,
      this.expression,
    );
  }

  tick(delta: number) {
    super.tick(delta);
    this.updateFace();
  }

  /** Apply what is cheap (offsets, visibility, bones) and reconcile the worn set when it changed. */
  syncItems() {
    if (!this.rig) return;
    const items = this.context?.items(this.id) ?? [];
    for (const item of items) item.renderOn(this);
    const signature = items
      .map(
        (item) =>
          `${item.id}:${item.itemId}:${item.color}:${JSON.stringify(item.channelColors)}`,
      )
      .join("|");
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

  /** Make the rig wear exactly the item children of this character. */
  private async reconcile() {
    const rig = this.rig;
    const gen = this.gen;
    if (!rig) return;
    const desired = this.context?.items(this.id) ?? [];
    const wanted = new Set(desired.map((item) => item.itemId));
    for (const id of [...rig.equipped.keys()])
      if (!wanted.has(id)) rig.unequip(id);
    for (const item of desired) {
      if (gen !== this.gen || this.disposed) return;
      const id = item.itemId;
      const key = `${item.color}:${JSON.stringify(item.channelColors)}`;
      const worn = rig.isEquipped(id);
      if (worn && this.itemColors.get(id) === key) continue;
      const record = await getItem(id);
      if (!record) throw new Error(`Missing item ${id}`);
      const colors = await itemTint(record, item.color, item.channelColors);
      if (gen !== this.gen || this.disposed) return;
      if (worn) {
        if (colors) rig.setItemColors(id, colors);
      } else {
        await rig.equip(record, colors);
      }
      if (gen !== this.gen || this.disposed) return;
      this.itemColors.set(id, key);
    }
    if (gen !== this.gen || this.disposed) return;
    for (const item of this.context?.items(this.id) ?? []) {
      item.resetMount();
      for (const object of rig.objectsOf(item.itemId))
        this.context?.tag(object, item.id);
      item.renderOn(this);
    }
    this.updateFace();
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
        }),
      ),
    };
  }

  dispose() {
    this.rig?.dispose();
    this.rig = null;
    super.dispose();
  }
}
