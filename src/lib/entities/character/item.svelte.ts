import { z } from 'zod';
import type { Group, Object3D } from 'three';
import { BaseEntity } from '../base.svelte.js';
import { ZERO, ONE } from '../constants.js';
import { CharacterEntity } from './character.svelte.js';
import { editableChannels } from './appearance.js';
import { channelsSchema } from './schemas.js';
import type { EntityInput } from '../types.js';
import { EntityProperty, type PropContext, type PropertyControl } from '../property.svelte.js';
import type { RenderContext } from '../render-context.js';
import { numericId, indexSchema } from '../validation.js';

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
