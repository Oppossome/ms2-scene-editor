import type { Object3D } from 'three';
import type { ClipInfo } from '../types.js';
import type { Entity, ItemEntity, PropEntity } from './entity.svelte.js';

/** Scene services an entity needs while rendering. */
export interface RenderContext {
  tag(object: Object3D, id: string): void;
  /** Something the UI reads (clips, bones, loaded models) changed. */
  changed(): void;
  /** Put every object under its parent's object (or bone) again. */
  reparent(): void;
  clips(id: string, clips: ClipInfo[]): void;
  defaultClip(id: string, clip: string): void;
  items(characterId: string): ItemEntity[];
  entity(id: string): Entity | undefined;
  /** Ask the shared instance batch to draw this prop; false when its model cannot be batched. */
  batch(prop: PropEntity): boolean;
  unbatch(prop: PropEntity): void;
  error(message: string, error: unknown): void;
}
