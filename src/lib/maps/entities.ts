import { z } from 'zod';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { entityMatrix } from './instancing.js';
import { newId, type Vec3 } from '../entities/constants.js';
import { restoreEntity } from '../entities/registry.js';
import type { Entity } from '../entities/types.js';
import type { GroupEntity } from '../entities/group.svelte.js';
import type { SceneDocument } from '../scene/document.js';
import { environmentSchema } from './environment.js';
import { finite } from '../entities/validation.js';
import type { MapData } from '../types.js';

const mapSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    models: z.array(z.string().min(1)),
    items: z.array(z.array(finite).length(10)),
    total: finite.int().nonnegative(),
    unresolved: finite.int().nonnegative(),
    environment: environmentSchema.optional()
  })
  .refine((data) => data.items.every((item) => Number.isInteger(item[0]) && !!data.models[item[0]]), {
    message: 'Invalid map model index'
  });

/** Position, Euler XYZ rotation (radians) and scale of a matrix, in the form scene entities store. */
export function decomposeForScene(matrix: Matrix4): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z]
  };
}

export async function fetchMap(id: string, signal?: AbortSignal): Promise<MapData> {
  const response = await fetch(`/api/maps/${id}`, { signal });
  if (!response.ok) throw new Error(`Map ${id}: HTTP ${response.status}`);
  return mapSchema.parse(await response.json());
}

/**
 * The children of a map's group: one editable prop per resolved placement (static, drawn in shared batches) and a
 * Lighting entity with the map's backdrop and fog. Nothing here is regenerated later: the group saves its children.
 */
export function composeMap(group: GroupEntity, data: MapData, allocate = newId): Entity[] {
  const props = data.items.map((item) => {
    const glb = data.models[item[0]];
    return restoreEntity({
      type: 'prop',
      id: allocate(),
      name: glb
        .split('/')
        .pop()!
        .replace(/\.glb$/i, ''),
      parentId: group.id,
      glb,
      instanced: true,
      ...decomposeForScene(entityMatrix(item))
    });
  });
  const lighting = restoreEntity({
    type: 'lighting',
    id: allocate(),
    name: 'Lighting',
    parentId: group.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    environment: data.environment ?? {}
  });
  return [...props, lighting];
}

/**
 * Add the props of maps saved as one node. This needs the map data, so it happens before the document replaces the
 * scene: a failure (or cancel) leaves the scene and its autosave untouched. New children follow the existing ones.
 */
export async function expandLegacyMaps(doc: SceneDocument, signal?: AbortSignal): Promise<Entity[]> {
  const used = new Set(doc.entities.map((entity) => entity.id));
  const allocate = () => {
    let id = newId();
    while (used.has(id)) id = newId();
    used.add(id);
    return id;
  };
  const generated: Entity[] = [];
  for (const group of doc.pendingMaps) {
    signal?.throwIfAborted();
    generated.push(...composeMap(group, await fetchMap(group.mapId!, signal), allocate));
  }
  return [...doc.entities, ...generated];
}
