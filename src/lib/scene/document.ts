import { z } from 'zod';
import { canHaveChildren, newId } from '../entities/constants.js';
import { restoreEntity } from '../entities/registry.js';
import type { Entity } from '../entities/types.js';
import type { GroupEntity } from '../entities/group.svelte.js';
import { issueText } from '../entities/validation.js';

export const SCENE_KEY = 'ms2se.scene.current';

/** Version 3 saves `entities` tagged with `type`; versions 1 and 2 saved `nodes` tagged with `kind`. */
const sceneEnvelopeSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  nodes: z.array(z.unknown()).optional(),
  entities: z.array(z.unknown()).optional(),
  /** The user's images the scene uses (id -> data URL), embedded by Export JSON; see `embeddedTextures`. */
  textures: z.record(z.string(), z.unknown()).optional().catch(undefined)
});

export interface SceneDocument {
  entities: Entity[];
  /** Groups made from maps saved before maps were groups: their props are still to be added (see `expandLegacyMaps`). */
  pendingMaps: GroupEntity[];
}

/**
 * Restore a scene from untrusted JSON. Entities that cannot be restored are dropped and reported, duplicate ids are
 * renamed, and parent links that point nowhere, form a cycle or break the rules (items only live on characters,
 * nothing lives on an item) are repaired by moving the entity to the root, or dropping it for items.
 * Versions 1 and 2 tagged entities with `kind` and saved a map as one node; version 3 tags them with `type`.
 */
export function parseScene(data: unknown, issues: string[] = []): SceneDocument | null {
  const envelope = sceneEnvelopeSchema.safeParse(data);
  if (!envelope.success) {
    issues.push(issueText(envelope.error));
    return null;
  }
  const { version } = envelope.data;
  const legacy = version < 3;
  const records = (legacy ? envelope.data.nodes : envelope.data.entities) ?? null;
  if (!records) {
    issues.push(legacy ? 'nodes: required' : 'entities: required');
    return null;
  }

  const entities: Entity[] = [];
  const pendingMaps: GroupEntity[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of records.entries()) {
    const path = `${legacy ? 'nodes' : 'entities'}.${index}`;
    try {
      if (!raw || typeof raw !== 'object') throw new Error('not an object');
      let record = raw as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id ? record.id : undefined;
      if (!id || seen.has(id)) {
        if (id) issues.push(`${path}.id: duplicate id replaced`);
        record = { ...record, id: newId() };
      }
      const isMap = legacy && record.kind === 'map';
      if (isMap) {
        if (typeof record.mapId !== 'string' || !/^\d+$/.test(record.mapId))
          throw new Error('mapId: expected a map id');
        record = { ...record, kind: 'group' };
      }
      if (legacy && version === 1 && record.kind === 'lighting') throw new Error('Lighting needs scene version 2');
      const entity = restoreEntity(record, { legacy, issues });
      seen.add(entity.id);
      entities.push(entity);
      if (isMap) pendingMaps.push(entity as GroupEntity);
    } catch (error) {
      issues.push(`${path}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const entity of entities) {
    if (entity.parentId && !byId.has(entity.parentId)) {
      issues.push(`${entity.id}.parentId: missing parent, moved to root`);
      entity.link(null);
    }
  }
  for (const entity of entities) {
    // Walk up; a revisit means a cycle, so cut the link at this entity.
    const visited = new Set<string>([entity.id]);
    let cur = entity.parentId ? byId.get(entity.parentId) : undefined;
    while (cur) {
      if (visited.has(cur.id)) {
        issues.push(`${entity.id}.parentId: cycle repaired`);
        entity.link(null);
        break;
      }
      visited.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const valid: Entity[] = [];
  for (const entity of entities) {
    const parent = entity.parentId ? byId.get(entity.parentId) : undefined;
    if (parent && !canHaveChildren(parent.type)) entity.link(null);
    const onCharacter = byId.get(entity.parentId ?? '')?.type === 'character';
    if (entity.type === 'item' && !onCharacter) continue;
    if (entity.attachBone && !onCharacter) entity.link(entity.parentId);
    valid.push(entity);
  }
  const kept = new Set(valid);
  return { entities: valid, pendingMaps: pendingMaps.filter((map) => kept.has(map)) };
}

export function parseSceneJson(text: string, issues: string[] = []): SceneDocument | null {
  try {
    return parseScene(JSON.parse(text), issues);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    issues.push(`Invalid JSON: ${error.message}`);
    return null;
  }
}

/** Ids of the user's images (texture overrides) that the entities of a saved scene use. */
export function sceneTextureIds(entities: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const entity of entities) {
    const textures = (entity as { textures?: unknown } | null)?.textures;
    if (!textures || typeof textures !== 'object') continue;
    for (const id of Object.values(textures)) if (typeof id === 'string') ids.add(id);
  }
  return [...ids];
}

/** The images a scene file carries (`textures`: id -> data URL), or null when it has none. */
export function embeddedTextures(data: unknown): Record<string, unknown> | null {
  const textures = (data as { textures?: unknown } | null)?.textures;
  return textures && typeof textures === 'object' && !Array.isArray(textures)
    ? (textures as Record<string, unknown>)
    : null;
}
