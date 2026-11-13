import { getItem } from '../../entities/character/build.js';
import { replacesItem } from '../../entities/character/item.svelte.js';
import type { FaceExpression } from '../../entities/character/expressions.js';
import type { ChannelDyes, Dye } from '../../entities/character/tint.js';
import type { HoldMode } from '../../entities/character/weapons.js';
import type { Entity, EntityInput } from '../../entities/types.js';
import { omitUndefined } from '../../entities/validation.js';
import type { ItemRecord } from '../../types.js';

/** An item to wear in a preview: its palette row and optional per-channel picks. */
export interface PreviewItem {
  id: string;
  color?: Dye;
  channels?: ChannelDyes;
  hold?: HoldMode;
}

/** What a preview shows, besides maps: always turned into scene entities that render exactly as in the scene. */
export type EntitySource =
  | { kind: 'model'; glb: string; scale?: number; clip?: string }
  /** A saved outfit. */
  | {
      kind: 'character';
      gender: 0 | 1;
      skin?: number;
      eye?: number;
      expression?: FaceExpression;
      items: PreviewItem[];
      clip?: string;
    }
  /**
   * An item tried on `base` (entity JSON from `sceneEntities`), or on a bare body without one. It replaces what
   * shares its slots unless `replace` is false.
   */
  | {
      kind: 'item';
      item: ItemRecord;
      gender: 0 | 1;
      color?: Dye;
      channels?: ChannelDyes;
      base?: EntityInput[];
      replace?: boolean;
    }
  /** Entities copied from the scene (`sceneEntities`). */
  | { kind: 'entities'; entities: EntityInput[]; clip?: string };

const ROOT = 'preview';
const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

/**
 * A scene entity and the items it wears as entity JSON for a preview: placed at the origin, without its own
 * animation state (a preview chooses the clip), so moving it or scrubbing it in the scene changes nothing here.
 */
export function sceneEntities(root: Entity, items: readonly Entity[] = []): EntityInput[] {
  const { position: _p, rotation: _r, clip: _c, freeze: _f, attachBone: _a, ...rest } = root.toJSON();
  return [
    { ...rest, parentId: null, visible: true, position: [0, 0, 0], rotation: [0, 0, 0] },
    ...items.map((item) => item.toJSON())
  ];
}

function itemJson(record: ItemRecord, parentId: string, index: number, worn: Omit<PreviewItem, 'id'>): EntityInput {
  return omitUndefined({
    type: 'item',
    id: `${ROOT}-item-${index}`,
    parentId,
    name: record.name,
    itemId: record.id,
    slots: record.slots,
    color: worn.color,
    channelColors: worn.channels,
    hold: worn.hold,
    ...IDENTITY
  });
}

/** The entity JSON a preview renders; the first entity is the one whose clips the preview plays. */
export async function previewEntities(source: EntitySource): Promise<EntityInput[]> {
  switch (source.kind) {
    case 'model': {
      const s = source.scale ?? 1;
      return [
        omitUndefined({
          type: 'npc',
          id: ROOT,
          name: 'Preview',
          glb: source.glb,
          clip: source.clip,
          ...IDENTITY,
          scale: [s, s, s]
        })
      ];
    }
    case 'character': {
      const character = omitUndefined({
        type: 'character',
        id: ROOT,
        name: 'Preview',
        gender: source.gender,
        skin: source.skin,
        eye: source.eye,
        expression: source.expression,
        clip: source.clip,
        ...IDENTITY
      });
      const records = await Promise.all(source.items.map((item) => getItem(item.id)));
      const items = records.flatMap((record, i) => (record ? [itemJson(record, ROOT, i, source.items[i])] : []));
      return [character, ...items];
    }
    case 'item': {
      const [root, ...worn] = source.base ?? [{ type: 'character', id: ROOT, name: 'Preview', ...IDENTITY }];
      const rootId = String(root.id);
      const next = { itemId: source.item.id, slots: source.item.slots };
      // What the character wears first; the new item replaces the same item, and whatever shares its slot.
      const kept = worn.filter((item) => {
        if (item.type !== 'item') return true;
        const wornItem = { itemId: String(item.itemId), slots: Array.isArray(item.slots) ? item.slots : [] };
        return source.replace === false ? wornItem.itemId !== next.itemId : !replacesItem(wornItem, next);
      });
      const tried = itemJson(source.item, rootId, worn.length, { color: source.color, channels: source.channels });
      return [{ ...root, gender: source.gender }, ...kept, tried];
    }
    case 'entities': {
      const [root, ...rest] = source.entities;
      return root ? [omitUndefined({ ...root, clip: source.clip }), ...rest] : [];
    }
  }
}
