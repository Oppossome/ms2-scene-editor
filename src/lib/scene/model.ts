import { parseChannelIndexes, type ChannelIndexes } from '../character/tint.js';
import type { OutfitSnapshot } from '../stores/outfits.js';

/**
 * The scene is a flat list of nodes linked by `parentId`. The array order is the sibling order, which keeps
 * undo snapshots and JSON simple. Bones are not nodes: a node is mounted on a bone of its parent character
 * through `attachBone`.
 */
export type NodeKind = 'group' | 'prop' | 'npc' | 'character' | 'item' | 'map';
export type Vec3 = [number, number, number];

export interface SceneNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  /** Bone (or dummy) of the parent character this node is mounted on. */
  attachBone?: string;
  /** Local transform. Euler XYZ rotation in radians. For an item it is an offset from its mount point. */
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  /** Converted model path (props and NPCs). */
  glb?: string;
  /** Map id (maps). */
  mapId?: string;
  /** Character body: 0 male, 1 female. */
  gender?: 0 | 1;
  /** Skin palette colour index of a character. */
  skin?: number;
  /** Eye colour (palette 3 index) of a character's own face. */
  eye?: number;
  /** Item id and palette colour (items). `slots` lets the data layer resolve slot conflicts without a lookup. */
  itemId?: string;
  color?: number;
  /** Palette rows picked per colour channel (main/accent/detail); channels not listed follow `color`. */
  channelColors?: ChannelIndexes;
  slots?: string[];
  /** Animation clip to loop (NPC clip name, or a body clip name for characters) and its speed. */
  clip?: string;
  speed?: number;
  /** Frame (at `FRAME_RATE`) the animation is held on; undefined while it plays. */
  freeze?: number;
}

export interface SceneData {
  version: 1;
  nodes: SceneNode[];
}

export const SCENE_KEY = 'bs2.scene.current';
/** Frames per second the clips are sampled at, so a frame number maps to a time. */
export const FRAME_RATE = 30;
export const DEFAULT_SKIN = 2;
export const DEFAULT_EYE = 5;

let counter = 0;
export function newId(): string {
  counter++;
  return `n${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export const ZERO: Vec3 = [0, 0, 0];
export const ONE: Vec3 = [1, 1, 1];

/** Kinds that can hold children. */
export function canHaveChildren(kind: NodeKind): boolean {
  return kind !== 'item';
}

const KINDS: readonly NodeKind[] = ['group', 'prop', 'npc', 'character', 'item', 'map'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Validate one untrusted node; returns null when it cannot be used. Parent links are repaired afterwards. */
function parseNode(raw: unknown): SceneNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as NodeKind;
  if (!KINDS.includes(kind)) return null;
  if (!isVec3(o.position) || !isVec3(o.rotation) || !isVec3(o.scale)) return null;
  const node: SceneNode = {
    id: str(o.id) ?? newId(),
    kind,
    name: typeof o.name === 'string' && o.name ? o.name : kind,
    parentId: str(o.parentId) ?? null,
    position: o.position,
    rotation: o.rotation,
    scale: o.scale,
    visible: o.visible !== false,
    locked: o.locked === true
  };
  const bone = str(o.attachBone);
  if (bone) node.attachBone = bone;
  if (kind === 'character') {
    if (o.gender !== 0 && o.gender !== 1) return null;
    node.gender = o.gender;
    node.skin = isNum(o.skin) && Number.isInteger(o.skin) && o.skin >= 0 ? o.skin : DEFAULT_SKIN;
    node.eye = isNum(o.eye) && Number.isInteger(o.eye) && o.eye >= 0 ? o.eye : DEFAULT_EYE;
  } else if (kind === 'item') {
    if (typeof o.itemId !== 'string' || !/^\d+$/.test(o.itemId)) return null;
    node.itemId = o.itemId;
    if (isNum(o.color) && Number.isInteger(o.color) && o.color >= 0) node.color = o.color;
    const channelColors = parseChannelIndexes(o.channelColors);
    if (channelColors) node.channelColors = channelColors;
    node.slots = Array.isArray(o.slots) ? o.slots.filter((s): s is string => typeof s === 'string' && !!s) : [];
  } else if (kind === 'map') {
    if (typeof o.mapId !== 'string' || !/^\d+$/.test(o.mapId)) return null;
    node.mapId = o.mapId;
  } else if (kind === 'prop' || kind === 'npc') {
    const glb = str(o.glb);
    if (!glb) return null;
    node.glb = glb;
  }
  const clip = str(o.clip);
  if (clip) node.clip = clip;
  if (isNum(o.speed) && o.speed > 0) node.speed = o.speed;
  if (isNum(o.freeze) && Number.isInteger(o.freeze) && o.freeze >= 0) node.freeze = o.freeze;
  return node;
}

/**
 * Validate untrusted JSON into scene data. Invalid nodes are dropped (with their subtree), duplicate ids are
 * renamed, and parent links that point nowhere, form a cycle or break the rules (items only live on characters,
 * nothing lives on an item) are repaired by moving the node to the root, or dropping it for items.
 */
export function parseScene(data: unknown): SceneData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.nodes)) return null;

  const nodes: SceneNode[] = [];
  const seen = new Set<string>();
  for (const raw of d.nodes) {
    const node = parseNode(raw);
    if (!node) continue;
    if (seen.has(node.id)) node.id = newId();
    seen.add(node.id);
    nodes.push(node);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (node.parentId && !byId.has(node.parentId)) node.parentId = null;
  }
  for (const node of nodes) {
    // Walk up; a revisit means a cycle, so cut the link at this node.
    const visited = new Set<string>([node.id]);
    let cur = node.parentId ? byId.get(node.parentId) : undefined;
    while (cur) {
      if (visited.has(cur.id)) {
        node.parentId = null;
        break;
      }
      visited.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const valid: SceneNode[] = [];
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && !canHaveChildren(parent.kind)) node.parentId = null;
    if (node.kind === 'item' && byId.get(node.parentId ?? '')?.kind !== 'character') continue;
    if (node.attachBone && byId.get(node.parentId ?? '')?.kind !== 'character') delete node.attachBone;
    valid.push(node);
  }
  return { version: 1, nodes: valid };
}

export function parseSceneJson(text: string): SceneData | null {
  try {
    return parseScene(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Snapshot of what a character wears, from its child item nodes (in sibling order). */
export function nodesToOutfit(nodes: SceneNode[], characterId: string): OutfitSnapshot | null {
  const character = nodes.find((n) => n.id === characterId);
  if (!character || character.kind !== 'character') return null;
  return {
    version: 1,
    gender: character.gender ?? 1,
    skin: character.skin ?? DEFAULT_SKIN,
    eye: character.eye ?? DEFAULT_EYE,
    items: nodes
      .filter((n) => n.parentId === characterId && n.kind === 'item' && n.itemId)
      .map((n) => ({
        id: n.itemId!,
        ...(n.color !== undefined ? { color: n.color } : {}),
        ...(n.channelColors ? { channels: n.channelColors } : {})
      }))
  };
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
