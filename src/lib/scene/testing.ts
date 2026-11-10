import { parseSceneJson } from './document.js';
import { restoreEntity } from '../entities/registry.js';
import type { Entity, EntityType } from '../entities/types.js';
import type { SceneState } from './store.svelte.js';

const required: Record<EntityType, Record<string, unknown>> = {
  group: {}, lighting: {}, prop: { glb: 'x.glb' }, npc: { glb: 'x.glb' }, character: { gender: 1 }, item: { itemId: '1' }
};

/** An entity with the values its type needs, for tests. */
export function entity(id: string, type: EntityType, parentId: string | null = null, extra: Record<string, unknown> = {}): Entity {
  return restoreEntity({
    type, id, name: id, parentId, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    ...required[type], ...extra
  });
}

/** Load a scene from JSON the way the studio does, for scenes without old-style maps. */
export function loadJson(store: SceneState, text: string): boolean {
  const doc = parseSceneJson(text);
  if (!doc || doc.pendingMaps.length) return false;
  store.load(doc.entities);
  return true;
}
