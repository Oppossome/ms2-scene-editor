import { z } from 'zod';
import { Group, type AnimationClip, type Object3D } from 'three';
import { AnimationPlayer } from '../assets/animation.js';
import { instantiate, loadClips } from '../assets/loader.js';
import { embeddedClips, fetchBodyClips, idleClip } from '../assets/clips.js';
import { bodyClipDir } from '../assets/urls.js';
import { eyeTint, getItem, itemTint, skinTint } from '../character/build.js';
import { CharacterRig } from '../character/rig.js';
import { FACE_OVERRIDES } from '../character/expressions.js';
import { InstanceTarget } from '../maps/entity-batches.js';
import type { ClipInfo } from '../types.js';
import type { OutfitSnapshot } from '../stores/outfits.js';
import { DEFAULT_EYE, DEFAULT_SKIN, FRAME_RATE, ONE, ZERO, newId } from './model.js';
import { BODY_PALETTE, EYE_PALETTE, editableChannels, lastFrame, type PropContext } from './properties.js';
import { EntityProperty, Vector3Property, type PropertyControl, type RegisteredProperty } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { channelsSchema, environmentSchema, expressionSchema, finite, indexSchema, issueText, numericId, omitUndefined } from './schemas.js';

const text = z.string();
const optionalText = text.min(1).optional();
const title = (value: string) => value[0].toUpperCase() + value.slice(1);

const ENTITY_LABELS = { group: 'Group', prop: 'Prop', npc: 'NPC', character: 'Character', item: 'Item', lighting: 'Lighting' };
export type EntityType = keyof typeof ENTITY_LABELS;
/** Property values by serialized key. */
export type EntityInput = Record<string, unknown>;

/**
 * An entity owns its properties (state, validation, editor rows and JSON), and its render resources. `render()`
 * brings existing resources in line with the properties and is cheap to repeat; `tick()` advances animation only.
 */
export abstract class BaseEntity {
  readonly id: string;
  abstract readonly type: EntityType;
  private readonly registered = new Map<string, RegisteredProperty>();
  /** Bumped when a property changes, so the scene knows what to render again. */
  revision = $state(0);
  renderedRevision = -1;
  disposed = false;
  protected gen = 0;
  protected context: RenderContext | null = null;
  /** The three.js group the transform applies to; absent for entities without geometry. */
  object: Group | null = null;

  readonly nameProperty = this.define('name', new EntityProperty(text.trim().min(1), 'Entity', (value) => ({
    key: 'name', label: 'Name', section: 'Data', type: 'string', value, edit: (name) => ({ name: name.trim() })
  })));
  readonly parentProperty = this.define('parentId', new EntityProperty(text.min(1).nullable(), null));
  readonly boneProperty = this.define('attachBone', new EntityProperty(optionalText, undefined, (value, ctx) =>
    ctx.parent?.type === 'character' && !(ctx.node.type === 'item' && ctx.skinned) ? {
      key: 'attachBone', label: 'Attach to', section: 'Attachment', type: 'enum', value: value ?? '',
      options: [
        { value: '', label: ctx.node.type === 'item' ? `(default: ${ctx.defaultBone || 'none'})` : '(character root)' },
        ...ctx.bones.map((bone) => ({ value: bone, label: bone.replace(/_/g, ' ') }))
      ],
      edit: (bone) => ({ attachBone: bone || undefined })
    } : null));
  readonly positionProperty = this.define('position', new Vector3Property('position', [...ZERO]));
  readonly rotationProperty = this.define('rotation', new Vector3Property('rotation', [...ZERO]));
  readonly scaleProperty = this.define('scale', new Vector3Property('scale', [...ONE]));
  readonly visibleProperty = this.define('visible', new EntityProperty(z.boolean(), true, (value) => ({
    key: 'visible', label: 'Visible', section: 'Appearance', type: 'bool', value, edit: (visible) => ({ visible })
  })));
  readonly lockedProperty = this.define('locked', new EntityProperty(z.boolean(), false, (value) => ({
    key: 'locked', label: 'Locked', section: 'Behaviour', type: 'bool', value, edit: (locked) => ({ locked })
  })));

  constructor(input: EntityInput = {}) {
    this.id = typeof input.id === 'string' && input.id ? input.id : newId();
  }

  get name() { return this.nameProperty.value; }
  get parentId() { return this.parentProperty.value; }
  get attachBone() { return this.boneProperty.value; }
  get position() { return this.positionProperty.value; }
  get rotation() { return this.rotationProperty.value; }
  get scale() { return this.scaleProperty.value; }
  get visible() { return this.visibleProperty.value; }
  get locked() { return this.lockedProperty.value; }

  protected define<T>(key: string, property: EntityProperty<T>): EntityProperty<T> {
    this.registered.set(key, property);
    return property;
  }

  // ----- state --------------------------------------------------------------------------------------------

  /** Validate edits without applying them; only values that differ are returned. */
  prepare(values: EntityInput): Map<RegisteredProperty, unknown> {
    const prepared = new Map<RegisteredProperty, unknown>();
    for (const [key, value] of Object.entries(values)) {
      const property = this.registered.get(key);
      if (!property) throw new Error(`${this.type} has no editable property ${key}`);
      let parsed: unknown;
      try {
        parsed = property.parse(value);
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        throw new Error(`${key}: ${issueText(error)}`);
      }
      if (JSON.stringify(parsed) !== JSON.stringify(property.value)) prepared.set(property, parsed);
    }
    return prepared;
  }

  apply(prepared: Map<RegisteredProperty, unknown>) {
    for (const [property, value] of prepared) property.assign(value);
    if (prepared.size) this.revision++;
  }

  /** Validate and apply edits at once (for entities that are not in a scene yet, or inside a transaction). */
  set(values: EntityInput) {
    this.apply(this.prepare(values));
  }

  /** Hierarchy moves are scene operations; the scene is the only caller. */
  link(parentId: string | null, attachBone?: string) {
    this.set({ parentId, attachBone });
  }

  // ----- JSON ---------------------------------------------------------------------------------------------

  /** Applying saved values never touches assets: restoring is cheap and rendering happens afterwards. */
  restore(input: EntityInput, issues: string[] = []): this {
    const values = new Map<RegisteredProperty, unknown>();
    for (const [key, property] of this.registered) {
      if (input[key] === undefined) {
        if (property.required) throw new Error(`${key}: required`);
        continue;
      }
      try {
        values.set(property, property.parse(input[key]));
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        if (property.required) throw new Error(`${key}: ${issueText(error)}`);
        issues.push(`${this.id}.${key}: ${issueText(error)}; default used`);
      }
    }
    if (!values.has(this.nameProperty)) values.set(this.nameProperty, this.type);
    this.apply(values);
    return this;
  }

  toJSON(): { type: EntityType; id: string } & EntityInput {
    return omitUndefined({
      type: this.type,
      id: this.id,
      ...Object.fromEntries([...this.registered].map(([key, property]) => [key, property.value]))
    });
  }

  controls(ctx: PropContext): PropertyControl[] {
    const info = (key: string, label: string, value: string): PropertyControl => ({ key, label, value, type: 'readonly', section: 'Data' });
    return [
      ...[...this.registered.values()].flatMap((property) => property.control(ctx) ?? []),
      info('class', 'Class', ENTITY_LABELS[this.type]),
      info('parent', 'Parent', ctx.parent?.name ?? '(scene)'),
      info('id', 'Id', this.id)
    ];
  }

  // ----- rendering ----------------------------------------------------------------------------------------

  protected createObject(): Group {
    return new Group();
  }

  /** Put the transform and visibility on the entity's group, creating it on first use. */
  protected renderTransform(context: RenderContext) {
    this.context = context;
    this.disposed = false;
    if (!this.object) {
      this.object = this.createObject();
      context.tag(this.object, this.id);
    }
    this.object.position.set(...this.position);
    this.object.rotation.set(...this.rotation, 'XYZ');
    this.object.scale.set(...this.scale);
    this.object.visible = this.visible;
    this.renderedRevision = this.revision;
  }

  render(context: RenderContext) {
    this.renderTransform(context);
  }

  tick(_delta: number) {}

  /** What the transform gizmo drives. */
  get gizmoTarget(): Object3D | undefined {
    return this.object ?? undefined;
  }

  /** What bounds, the selection outline and group centering measure. */
  boundsTargets(): Object3D[] {
    return this.object ? [this.object] : [];
  }

  dispose() {
    this.disposed = true;
    this.gen++;
    this.object?.removeFromParent();
    this.context?.changed();
  }
}

export class GroupEntity extends BaseEntity {
  readonly type = 'group';
  /** Set on groups made from a map: where their props came from (not used to regenerate them). */
  readonly sourceProperty = this.define('mapId', new EntityProperty(numericId.optional(), undefined, (value) => value ? {
    key: 'mapId', label: 'Map id', section: 'Source', type: 'readonly', value
  } : null));
  get mapId() { return this.sourceProperty.value; }
}

/** A model with a skeleton and animation clips: the clip, speed and held frame properties and their playback. */
export abstract class RiggedModel extends BaseEntity {
  readonly clipProperty = this.define('clip', new EntityProperty(optionalText, undefined));
  readonly speedProperty = this.define('speed', new EntityProperty(finite.positive().optional(), undefined));
  readonly freezeProperty = this.define('freeze', new EntityProperty(indexSchema.optional(), undefined));
  get clip() { return this.clipProperty.value; }
  get speed() { return this.speedProperty.value; }
  get freeze() { return this.freezeProperty.value; }

  player: AnimationPlayer | null = null;
  protected clipRequested: string | undefined;
  private freezeApplied: number | undefined;

  controls(ctx: PropContext): PropertyControl[] {
    const rows = super.controls(ctx);
    if (!ctx.clips.length) return rows;
    return [...rows, {
      key: 'clip', label: 'Clip', section: 'Animation', type: 'clip', value: this.clip ?? '', clips: ctx.clips,
      edit: (value) => {
        const clip = value || undefined;
        const last = lastFrame(ctx.clips, clip);
        // A held frame stays on the same frame of the new clip, or on its last one when that is shorter.
        return { clip, ...(this.freeze !== undefined && last !== undefined ? { freeze: Math.min(this.freeze, last) } : {}) };
      }
    }, {
      key: 'speed', label: 'Speed', section: 'Animation', type: 'number', value: this.speed ?? 1, step: 0.1, min: 0.05,
      edit: (speed) => ({ speed })
    }, {
      key: 'playback', label: 'Playback', section: 'Animation', type: 'transport',
      frame: this.freeze === undefined ? undefined : Math.min(this.freeze, lastFrame(ctx.clips, this.clip) ?? this.freeze),
      max: lastFrame(ctx.clips, this.clip)
    }];
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
      if (clip) player.play(clip, true);
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

/** A model loaded from a converted GLB. */
export abstract class ModelEntity extends RiggedModel {
  readonly modelProperty = this.define('glb', new EntityProperty(text.min(1), '', (value) => ({
    key: 'glb', label: 'Model', section: 'Source', type: 'readonly', value
  }), true));
  get glb() { return this.modelProperty.value; }
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

export class PropEntity extends ModelEntity {
  readonly type = 'prop';
  /** Placed from a map: static, drawn with the other copies of its model in one shared batch when possible. */
  readonly instanceProperty = this.define('instanced', new EntityProperty(z.boolean().optional(), undefined));
  get instanced() { return this.instanceProperty.value; }
  /** Runtime only: whether the scene's batch currently draws this prop. */
  batched = false;

  protected createObject() {
    return this.instanced ? new InstanceTarget() : new Group();
  }

  render(context: RenderContext) {
    this.renderTransform(context);
    if (this.instanced && context.batch(this)) {
      if (!this.batched) this.unloadModel();
      this.batched = true;
      return;
    }
    if (this.batched) context.unbatch(this);
    this.batched = false;
    super.render(context);
  }

  dispose() {
    this.context?.unbatch(this);
    this.batched = false;
    super.dispose();
  }
}

export class CharacterEntity extends RiggedModel {
  readonly type = 'character';
  readonly genderProperty = this.define('gender', new EntityProperty(z.union([z.literal(0), z.literal(1)]), 1, (value) => ({
    key: 'gender', label: 'Gender', section: 'Appearance', type: 'enum', value: String(value),
    options: [{ value: '1', label: 'Female' }, { value: '0', label: 'Male' }],
    edit: (gender) => ({ gender: gender === '0' ? 0 : 1 })
  }), true));
  readonly skinProperty = this.define('skin', new EntityProperty(indexSchema, DEFAULT_SKIN, (value) => ({
    key: 'skin', label: 'Skin tone', section: 'Appearance', type: 'palette', value, palette: BODY_PALETTE, edit: (skin) => ({ skin })
  })));
  readonly eyeProperty = this.define('eye', new EntityProperty(indexSchema, DEFAULT_EYE, (value) => ({
    key: 'eye', label: 'Eye colour', section: 'Appearance', type: 'palette', value, palette: EYE_PALETTE, channel: 0, edit: (eye) => ({ eye })
  })));
  /** Undefined: the face follows the animation. */
  readonly expressionProperty = this.define('expression', new EntityProperty(expressionSchema.optional(), undefined, (value) => ({
    key: 'expression', label: 'Expression', section: 'Appearance', type: 'enum', value: value ?? '',
    options: [{ value: '', label: 'Automatic (animation)' }, ...FACE_OVERRIDES.map((name) => ({ value: name, label: title(name) }))],
    edit: (name) => ({ expression: name || undefined })
  })));
  get gender() { return this.genderProperty.value; }
  get skin() { return this.skinProperty.value; }
  get eye() { return this.eyeProperty.value; }
  get expression() { return this.expressionProperty.value; }

  rig: CharacterRig | null = null;
  private genderApplied: number | undefined;
  private skinApplied: number | undefined;
  private eyeApplied: number | undefined;
  private appearanceGen = 0;
  private itemSig = '';
  private itemColors = new Map<string, string>();
  private reconciling = false;
  private dirty = false;

  render(context: RenderContext) {
    super.render(context);
    if (this.genderApplied !== this.gender) {
      this.genderApplied = this.gender;
      void this.loadRig();
    }
    if (this.rig && (this.skinApplied !== this.skin || this.eyeApplied !== this.eye)) void this.applyAppearance();
    this.updateFace();
    this.syncItems();
  }

  private async loadRig() {
    const gen = ++this.gen;
    this.clearPlayer();
    this.rig?.dispose();
    this.rig = null;
    for (const item of this.context?.items(this.id) ?? []) item.resetMount();
    this.itemSig = '';
    this.itemColors.clear();
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

  private updateFace() {
    this.rig?.updateFace(this.player?.clip?.name ?? '', this.player?.time ?? 0, this.expression);
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
    const signature = items.map((item) => `${item.id}:${item.itemId}:${item.color}:${JSON.stringify(item.channelColors)}`).join('|');
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
    for (const id of [...rig.equipped.keys()]) if (!wanted.has(id)) rig.unequip(id);
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
      for (const object of rig.objectsOf(item.itemId)) this.context?.tag(object, item.id);
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
      items: items.map((item) => omitUndefined({ id: item.itemId, color: item.color, channels: item.channelColors }))
    };
  }

  dispose() {
    this.rig?.dispose();
    this.rig = null;
    super.dispose();
  }
}

/** A worn item: its meshes belong to the parent character's rig, which this entity only configures. */
export class ItemEntity extends BaseEntity {
  readonly type = 'item';
  readonly sourceProperty = this.define('itemId', new EntityProperty(numericId, '0', (value) => ({
    key: 'itemId', label: 'Item id', section: 'Source', type: 'readonly', value
  }), true));
  readonly slotsProperty = this.define('slots', new EntityProperty(
    z.array(z.unknown()).transform((list) => list.filter((slot): slot is string => typeof slot === 'string' && !!slot)),
    [] as string[],
    (value) => ({ key: 'slots', label: 'Slots', section: 'Source', type: 'readonly', value: value.join(', ') })
  ));
  readonly colorProperty = this.define('color', new EntityProperty(indexSchema.optional(), undefined, (value, ctx) => ctx.palette ? {
    key: 'color', label: editableChannels(ctx.channels).length > 1 ? 'Colour set' : 'Colour',
    section: 'Appearance', type: 'palette', value: value ?? -1, palette: ctx.palette, edit: (color) => this.chooseColor(color)
  } : null));
  readonly channelsProperty = this.define('channelColors', new EntityProperty(channelsSchema.optional(), undefined));
  get itemId() { return this.sourceProperty.value; }
  get slots() { return this.slotsProperty.value; }
  get color() { return this.colorProperty.value; }
  get channelColors() { return this.channelsProperty.value; }

  private mountedBone = '';
  private mount: Group | null = null;

  /** Picking a colour set starts over: every channel follows it again. */
  chooseColor(color: number): EntityInput {
    return { color, channelColors: undefined };
  }

  resetOffset(): EntityInput {
    return { position: [...ZERO], rotation: [...ZERO], scale: [...ONE] };
  }

  render(context: RenderContext) {
    this.context = context;
    this.disposed = false;
    this.renderedRevision = this.revision;
    const parent = this.parentId ? context.entity(this.parentId) : undefined;
    if (parent instanceof CharacterEntity) this.renderOn(parent);
  }

  renderOn(parent: CharacterEntity) {
    const rig = parent.rig;
    if (!rig?.isEquipped(this.itemId)) return;
    const mounts = rig.mountsOf(this.itemId);
    const bone = this.attachBone ?? '';
    if (mounts.length && this.mountedBone !== bone) {
      rig.mountOn(this.itemId, bone);
      this.mountedBone = bone;
    }
    for (const mount of mounts) {
      mount.position.set(...this.position);
      mount.rotation.set(...this.rotation, 'XYZ');
      mount.scale.set(...this.scale);
    }
    this.mount = mounts[0] ?? null;
    rig.setItemVisible(this.itemId, this.visible);
  }

  resetMount() {
    this.mount = null;
    this.mountedBone = '';
  }

  /** Skinned clothes follow the skeleton and have no mount to drive. */
  get gizmoTarget() {
    return this.mount ?? undefined;
  }

  boundsTargets(): Object3D[] {
    const parent = this.parentId ? this.context?.entity(this.parentId) : undefined;
    if (!this.visible || !(parent instanceof CharacterEntity)) return [];
    return parent.rig?.objectsOf(this.itemId).filter((object) => object.visible) ?? [];
  }

  controls(ctx: PropContext): PropertyControl[] {
    const rows = super.controls(ctx);
    if (!ctx.skinned) {
      rows.push({ key: 'resetOffset', label: 'Offset', section: 'Attachment', type: 'action', value: 'Reset offset', edit: () => this.resetOffset() });
    }
    const channels = editableChannels(ctx.channels);
    if (ctx.palette && channels.length > 1) {
      for (const channel of channels) {
        rows.push({
          key: `colorCh${channel}`, label: channel === 0 ? 'Main' : 'Detail', section: 'Appearance', type: 'palette',
          value: this.channelColors?.[`ch${channel}`] ?? this.color ?? -1, palette: ctx.palette, channel,
          edit: (value) => ({ channelColors: { ...this.channelColors, [`ch${channel}`]: value } })
        });
      }
    }
    return rows;
  }

  dispose() {
    this.disposed = true;
    this.resetMount();
  }
}

/** The scene's painted backdrop and distance fog. It has no geometry. */
export class LightingEntity extends BaseEntity {
  readonly type = 'lighting';
  readonly environmentProperty = this.define('environment', new EntityProperty(environmentSchema, {}));
  get environment() { return this.environmentProperty.value; }

  render(context: RenderContext) {
    this.context = context;
    this.disposed = false;
    this.renderedRevision = this.revision;
  }

  controls(ctx: PropContext): PropertyControl[] {
    const env = this.environment;
    const fog = env.fog ?? { color: [199, 237, 255] as [number, number, number], near: 5276, far: 20000 };
    return [...super.controls(ctx), {
      key: 'background', label: 'Backdrop', section: 'Environment', type: 'backdrop', value: env.background ?? '',
      edit: (background) => ({ environment: { ...env, background: background || undefined } })
    }, {
      key: 'fog', label: 'Fog', section: 'Environment', type: 'bool', value: !!env.fog,
      edit: (enabled) => ({ environment: { ...env, fog: enabled ? fog : undefined } })
    }, ...(env.fog ? [{
      key: 'fogColor', label: 'Fog RGB', section: 'Environment', type: 'vec3' as const, value: fog.color, step: 1, min: 0, max: 255,
      edit: (color: [number, number, number]) => ({ environment: { ...env, fog: { ...fog, color } } })
    }, ...(['near', 'far'] as const).map((key): PropertyControl => ({
      key: `fog${key}`, label: title(key), section: 'Environment', type: 'number', value: fog[key], min: 0,
      edit: (value) => ({ environment: { ...env, fog: { ...fog, [key]: value } } })
    }))] : [])];
  }
}

export type Entity = GroupEntity | PropEntity | NpcEntity | CharacterEntity | ItemEntity | LightingEntity;

/** The saved `type` tag selects the class; nothing else in a document can name a constructor. */
const entityTypes = new Map<string, new (input?: EntityInput) => Entity>([
  ['group', GroupEntity], ['prop', PropEntity], ['npc', NpcEntity],
  ['character', CharacterEntity], ['item', ItemEntity], ['lighting', LightingEntity]
]);

/** Make an entity from saved values (or a creation spec), tagged by `type` (`kind` in versions 1 and 2). */
export function restoreEntity(input: unknown, options: { legacy?: boolean; issues?: string[] } = {}): Entity {
  const record = z.record(z.string(), z.unknown()).parse(input);
  const type = options.legacy ? record.kind : record.type;
  const Constructor = typeof type === 'string' ? entityTypes.get(type) : undefined;
  if (!Constructor) throw new Error(`Unknown entity type: ${String(type)}`);
  return new Constructor(record).restore(record, options.issues);
}
