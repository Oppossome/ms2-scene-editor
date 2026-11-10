import type { GroupEntity } from './group.svelte.js';
import type { NpcEntity } from './model.svelte.js';
import type { PropEntity } from './prop.svelte.js';
import type { CharacterEntity } from './character/character.svelte.js';
import type { ItemEntity } from './character/item.svelte.js';
import type { LightingEntity } from './lighting.svelte.js';

export const ENTITY_LABELS = {
  group: 'Group',
  prop: 'Prop',
  npc: 'NPC',
  character: 'Character',
  item: 'Item',
  lighting: 'Lighting'
};
export type EntityType = keyof typeof ENTITY_LABELS;
export type EntityInput = Record<string, unknown>;

export type Entity = GroupEntity | PropEntity | NpcEntity | CharacterEntity | ItemEntity | LightingEntity;
