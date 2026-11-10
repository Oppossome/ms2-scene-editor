import { z } from 'zod';
import type { Entity, EntityInput } from './types.js';
import { GroupEntity } from './group.svelte.js';
import { NpcEntity } from './model.svelte.js';
import { PropEntity } from './prop.svelte.js';
import { CharacterEntity } from './character/character.svelte.js';
import { ItemEntity } from './character/item.svelte.js';
import { LightingEntity } from './lighting.svelte.js';

/** The saved `type` tag selects the class; nothing else in a document can name a constructor. */
const entityTypes = new Map<string, new (input?: EntityInput) => Entity>([
  ['group', GroupEntity],
  ['prop', PropEntity],
  ['npc', NpcEntity],
  ['character', CharacterEntity],
  ['item', ItemEntity],
  ['lighting', LightingEntity]
]);

/** Make an entity from saved values (or a creation spec), tagged by `type` (`kind` in versions 1 and 2). */
export function restoreEntity(input: unknown, options: { legacy?: boolean; issues?: string[] } = {}): Entity {
  const record = z.record(z.string(), z.unknown()).parse(input);
  const type = options.legacy ? record.kind : record.type;
  const Constructor = typeof type === 'string' ? entityTypes.get(type) : undefined;
  if (!Constructor) throw new Error(`Unknown entity type: ${String(type)}`);
  return new Constructor(record).restore(record, options.issues);
}
