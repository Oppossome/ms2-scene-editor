import type { OutfitSnapshot } from '../stores/outfits.js';
import { parseSnapshot } from '../stores/outfits.js';

export type ObjectKind = 'prop' | 'npc' | 'character' | 'map';
export type Vec3 = [number, number, number];

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  name: string;
  /** Converted model path (props and NPCs). */
  glb?: string;
  /** Map id (maps): the whole map is drawn as one object. */
  mapId?: string;
  /** Outfit of a character. */
  outfit?: OutfitSnapshot;
  /** Animation clip to loop (NPC clip name, or a body clip name for characters). */
  clip?: string;
  position: Vec3;
  /** Euler XYZ in radians. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
}

export interface SceneData {
  version: 1;
  objects: SceneObject[];
}

export const SCENE_KEY = 'bs2.scene.current';

let counter = 0;
export function newId(): string {
  counter++;
  return `o${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Validate untrusted JSON into scene data; invalid objects are dropped, a wrong envelope yields null. */
export function parseScene(data: unknown): SceneData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.objects)) return null;
  const objects: SceneObject[] = [];
  const seen = new Set<string>();
  for (const raw of d.objects) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (o.kind !== 'prop' && o.kind !== 'npc' && o.kind !== 'character' && o.kind !== 'map') continue;
    if (!isVec3(o.position) || !isVec3(o.rotation) || !isVec3(o.scale)) continue;
    const obj: SceneObject = {
      id: typeof o.id === 'string' && o.id && !seen.has(o.id) ? o.id : newId(),
      kind: o.kind,
      name: typeof o.name === 'string' ? o.name : o.kind,
      position: o.position,
      rotation: o.rotation,
      scale: o.scale,
      visible: o.visible !== false
    };
    if (o.kind === 'character') {
      const outfit = parseSnapshot(o.outfit);
      if (!outfit) continue;
      obj.outfit = outfit;
    } else if (o.kind === 'map') {
      if (typeof o.mapId !== 'string' || !/^\d+$/.test(o.mapId)) continue;
      obj.mapId = o.mapId;
    } else {
      if (typeof o.glb !== 'string' || !o.glb) continue;
      obj.glb = o.glb;
    }
    if (typeof o.clip === 'string' && o.clip) obj.clip = o.clip;
    seen.add(obj.id);
    objects.push(obj);
  }
  return { version: 1, objects };
}

export function parseSceneJson(text: string): SceneData | null {
  try {
    return parseScene(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Snapshot-based undo/redo history. States are opaque strings (serialised scenes). */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Remember `state` as the point to return to; invalidates redo. */
  record(state: string) {
    if (this.past[this.past.length - 1] === state) return;
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
