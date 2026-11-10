import { untrack } from 'svelte';
import {
  DEFAULT_EYE,
  DEFAULT_SKIN,
  History,
  ONE,
  SCENE_KEY,
  ZERO,
  canHaveChildren,
  type Vec3
} from './model.js';
import type { ChannelIndexes } from '../character/tint.js';
import type { FaceExpression } from '../character/expressions.js';
import type { MapEnvironment } from '../types.js';
import { canParent, cloneSubtree, deleteSubtree, uniqueName } from './tree.js';
import { CharacterEntity, ItemEntity, restoreEntity, type Entity, type EntityInput, type EntityType } from './entity.svelte.js';
import type { RegisteredProperty } from './property.svelte.js';
import { omitUndefined } from './schemas.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type GizmoSpace = 'local' | 'world';
const SCENE_VERSION = 3;

export interface NewNode {
  type: EntityType;
  name: string;
  parentId?: string | null;
  attachBone?: string;
  beforeId?: string | null;
  glb?: string;
  mapId?: string;
  gender?: 0 | 1;
  skin?: number;
  eye?: number;
  expression?: FaceExpression;
  itemId?: string;
  color?: number;
  channelColors?: ChannelIndexes;
  slots?: string[];
  clip?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  instanced?: boolean;
  environment?: MapEnvironment;
}

export interface NewItem {
  itemId: string;
  name: string;
  slots: string[];
  color?: number;
  channelColors?: ChannelIndexes;
  attachBone?: string;
}

/** Local transform a node needs to keep its world pose under a new parent. */
export interface LocalTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface BoneSelection {
  characterId: string;
  bone: string;
}

/** A new entity from a creation spec; the same validation as restoring a save applies. */
function createEntity(spec: NewNode, parentId: string | null): Entity {
  const { type, beforeId: _before, channelColors, ...rest } = spec;
  return restoreEntity(
    {
      position: [...ZERO],
      rotation: [...ZERO],
      scale: [...ONE],
      ...(type === 'character' ? { gender: 1, skin: DEFAULT_SKIN, eye: DEFAULT_EYE } : {}),
      ...(type === 'item' ? { slots: [] } : {}),
      ...omitUndefined({ ...rest, channelColors: channelColors && Object.keys(channelColors).length ? { ...channelColors } : undefined }),
      type,
      parentId
    }
  );
}

const itemSpec = (item: NewItem): NewNode => ({
  type: 'item', name: item.name, itemId: item.itemId, slots: item.slots, color: item.color,
  channelColors: item.channelColors, attachBone: item.attachBone
});

/** Where a new node may go within `list`: items need a character parent, nothing lives on an item. */
function parentIn(list: Entity[], spec: NewNode): string | null | undefined {
  const parentId = spec.parentId ?? null;
  const parent = parentId ? list.find((n) => n.id === parentId) : undefined;
  if (spec.type === 'item') return parent?.type === 'character' ? parentId : undefined;
  if (parentId && (!parent || !canHaveChildren(parent.type))) return null;
  return parentId;
}

/** The scene being edited: the entity tree, selection, undo/redo and persistence. */
export class SceneState {
  private entities = $state.raw<Entity[]>([]);
  /** Bumped on every change to the document (properties or structure): autosave and rendering follow it. */
  revision = $state(0);
  /** Entities to render again at the next sync (cleared by the renderer). */
  changedIds = new Set<string>();
  error = $state('');
  private pendingSnapshot: string | null = null;
  private gesture = false;
  private transactionDepth = 0;

  get nodes(): Entity[] {
    return this.entities;
  }

  private set nodes(next: Entity[]) {
    this.commit();
    const before = new Set(this.entities);
    const after = new Set(next);
    for (const entity of next) if (!before.has(entity)) this.changedIds.add(entity.id);
    // A character dresses itself from its children, so it renders again when one leaves.
    for (const entity of this.entities) if (!after.has(entity) && entity.parentId) this.changedIds.add(entity.parentId);
    this.entities = next;
    this.revision++;
  }

  selectedId = $state<string | null>(null);
  selectedBone = $state.raw<BoneSelection | null>(null);
  mode = $state<GizmoMode>('translate');
  space = $state<GizmoSpace>('world');
  snap = $state(false);
  /** Explorer open state by key (entity id, or `skel:<characterId>` / `bone:<characterId>:<name>`). */
  expanded = $state.raw<Record<string, boolean>>({});

  hooks: {
    /** Filled in by the renderer: the local transform a node needs to keep its world pose under a new parent. */
    localFor?: (id: string, parentId: string | null, bone?: string) => LocalTransform | null;
    /** Asynchronous document loads in flight are cancelled when the document changes under them. */
    cancelLoad?: () => void;
  } = {};

  private history = new History(100);
  /** Bumped on every history change so the UI can reflect canUndo/canRedo. */
  historyVersion = $state(0);
  private indexCache: { nodes: Entity[]; map: Map<string, Entity> } | null = null;

  get byId(): Map<string, Entity> {
    if (this.indexCache?.nodes !== this.nodes) {
      this.indexCache = { nodes: this.nodes, map: new Map(this.nodes.map((n) => [n.id, n])) };
    }
    return this.indexCache.map;
  }

  node(id: string | null | undefined): Entity | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  get selected(): Entity | undefined {
    return this.node(this.selectedId);
  }

  /** The item entities a character wears, in sibling order. */
  itemsOf(characterId: string): ItemEntity[] {
    return this.nodes.filter((n): n is ItemEntity => n.type === 'item' && n.parentId === characterId);
  }

  get canUndo() {
    void this.historyVersion;
    return this.history.canUndo;
  }

  get canRedo() {
    void this.historyVersion;
    return this.history.canRedo;
  }

  // ----- history ------------------------------------------------------------------------------------------

  /** Remember the current state so the next change can be undone. */
  private record() {
    if (this.gesture) return;
    this.pendingSnapshot ??= this.serializeNodes();
  }

  private serializeNodes() {
    return JSON.stringify(this.nodes);
  }

  private commit() {
    if (this.pendingSnapshot !== null && !this.transactionDepth) {
      this.history.record(this.pendingSnapshot);
      this.pendingSnapshot = null;
      untrack(() => this.historyVersion++);
    }
  }

  /** A continuous edit (drag, scrub, typing): everything until `endGesture` is one undo step. */
  beginGesture() {
    this.endGesture();
    this.record();
    this.gesture = true;
  }

  endGesture() {
    const active = this.gesture;
    this.gesture = false;
    if (active || !this.transactionDepth) this.pendingSnapshot = null;
  }

  /** Everything the action changes is one undo step, and none when it changes nothing. A failure rolls back. */
  transaction(action: () => void) {
    if (!this.transactionDepth) this.endGesture();
    this.transactionDepth++;
    try {
      action();
    } catch (error) {
      const snapshot = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (snapshot !== null) {
        this.nodes = this.restoreAll(snapshot);
        this.fixSelection();
      }
      throw error;
    } finally {
      if (!--this.transactionDepth) {
        if (this.pendingSnapshot !== null && this.serializeNodes() === this.pendingSnapshot) this.pendingSnapshot = null;
        this.commit();
      }
    }
  }

  private restoreAll(text: string): Entity[] {
    return (JSON.parse(text) as unknown[]).map((record) => restoreEntity(record));
  }

  // ----- adding and removing ------------------------------------------------------------------------------

  private insert(list: Entity[], node: Entity, beforeId?: string | null): Entity[] {
    const at = beforeId ? list.findIndex((n) => n.id === beforeId) : -1;
    return at < 0 ? [...list, node] : [...list.slice(0, at), node, ...list.slice(at)];
  }

  add(spec: NewNode, select = true): string {
    const parentId = parentIn(this.nodes, spec);
    if (parentId === undefined) return '';
    this.record();
    const bone = this.node(parentId)?.type === 'character' ? spec.attachBone : undefined;
    const node = createEntity({ ...spec, attachBone: bone, name: uniqueName(this.nodes, parentId, spec.name) }, parentId);
    this.nodes = this.insert(this.nodes, node, spec.beforeId);
    if (select) this.select(node.id);
    if (parentId) this.setExpanded(parentId, true);
    return node.id;
  }

  /** Add already made entities (a map import) in one undo step. */
  append(entities: Entity[]) {
    if (!entities.length) return;
    this.record();
    this.nodes = [...this.nodes, ...entities];
  }

  /** Wear an item: a child item of the character. Items in the same slots (or the same item) are replaced. */
  equipItem(characterId: string, item: NewItem, select = true): string {
    if (this.node(characterId)?.type !== 'character') return '';
    this.record();
    const clash = (n: ItemEntity) => n.itemId === item.itemId || n.slots.some((s) => item.slots.includes(s));
    const kept = this.nodes.filter((n) => !(n instanceof ItemEntity && n.parentId === characterId && clash(n)));
    const node = createEntity(itemSpec(item), characterId);
    this.nodes = this.insert(kept, node);
    if (select) this.select(node.id);
    this.setExpanded(characterId, true);
    return node.id;
  }

  /** Replace everything a character wears (one undo step); nothing changes when it already wears exactly this. */
  setOutfit(characterId: string, items: NewItem[]) {
    if (this.node(characterId)?.type !== 'character') return;
    const current = this.itemsOf(characterId);
    const same = (node: ItemEntity, item: NewItem) =>
      node.itemId === item.itemId && node.name === item.name && node.color === item.color &&
      JSON.stringify(node.slots) === JSON.stringify(item.slots) &&
      JSON.stringify(node.channelColors) === JSON.stringify(item.channelColors) &&
      !node.attachBone && [...node.position, ...node.rotation].every((v) => v === 0) && node.scale.every((v) => v === 1);
    if (current.length === items.length && current.every((node, i) => same(node, items[i]))) return;
    this.record();
    const kept = this.nodes.filter((n) => !(n.type === 'item' && n.parentId === characterId));
    this.nodes = [...kept, ...items.map((item) => createEntity({ ...itemSpec(item), attachBone: undefined }, characterId))];
    this.setExpanded(characterId, true);
  }

  /** A character with its outfit, in one undo step. */
  addCharacter(
    spec: { name: string; gender: 0 | 1; skin?: number; eye?: number; expression?: FaceExpression; parentId?: string | null; position?: Vec3 },
    items: NewItem[] = []
  ): string {
    const parentId = parentIn(this.nodes, { type: 'character', name: spec.name, parentId: spec.parentId });
    if (parentId === undefined) return '';
    this.record();
    const character = createEntity(
      { type: 'character', name: spec.name, gender: spec.gender, skin: spec.skin, eye: spec.eye, expression: spec.expression, position: spec.position },
      parentId
    );
    const children = items.map((item) => createEntity({ ...itemSpec(item), attachBone: undefined }, character.id));
    this.nodes = [...this.nodes, character, ...children];
    this.select(character.id);
    this.setExpanded(character.id, true);
    if (parentId) this.setExpanded(parentId, true);
    return character.id;
  }

  remove(id: string) {
    this.hooks.cancelLoad?.();
    if (!this.node(id)) return;
    this.record();
    this.nodes = deleteSubtree(this.nodes, id);
    this.fixSelection();
  }

  /** Copy a node with everything below it (not items: a character holds one of each). */
  duplicate(id: string): string | null {
    const src = this.node(id);
    if (!src || src.type === 'item') return null;
    const copies = cloneSubtree(this.nodes, id);
    if (!copies.length) return null;
    this.record();
    const root = copies[0];
    root.set({ name: uniqueName(this.nodes, root.parentId, `${src.name} copy`), position: [src.position[0] + 60, src.position[1], src.position[2] + 60] });
    this.nodes = [...this.nodes, ...copies];
    this.select(root.id);
    return root.id;
  }

  // ----- editing ------------------------------------------------------------------------------------------

  /** Change an entity; continuous edits (dragging) call `beginGesture()` first and pass record=false. */
  update(id: string, values: EntityInput, record = true) {
    this.updateMany([{ id, values }], record);
  }

  /** Validate every change before applying any of them. */
  updateMany(updates: { id: string; values: EntityInput }[], record = true) {
    try {
      const prepared: { entity: Entity; values: Map<RegisteredProperty, unknown> }[] = [];
      for (const { id, values } of updates) {
        const entity = this.node(id);
        if (!entity) continue;
        if ('type' in values || 'id' in values) throw new Error('An entity keeps its type and id');
        if ('parentId' in values) throw new Error('Use reparent to change the hierarchy');
        if (values.attachBone && this.node(entity.parentId)?.type !== 'character') throw new Error('A bone mount needs a character parent');
        const changed = entity.prepare(values);
        if (changed.size) prepared.push({ entity, values: changed });
      }
      if (!prepared.length) return;
      if (record) this.record();
      this.commit();
      for (const { entity, values } of prepared) {
        entity.apply(values);
        this.changedIds.add(entity.id);
        if (entity.parentId) this.changedIds.add(entity.parentId);
      }
      this.revision++;
      this.error = '';
    } catch (error) {
      this.error = `Cannot edit scene: ${error instanceof Error ? error.message : error}`;
      console.warn(this.error);
    }
  }

  /** Update several node positions in one undo step. */
  updatePositions(updates: { id: string; position: Vec3 }[]) {
    this.updateMany(updates.map(({ id, position }) => ({ id, values: { position } })));
  }

  rename(id: string, name: string) {
    const node = this.node(id);
    const next = name.trim();
    if (!node || !next || next === node.name) return;
    this.update(id, { name: next });
  }

  /**
   * Move a node under a new parent (null = root), before a sibling, optionally mounted on a bone of the parent
   * character. The node keeps its world pose unless it is an item.
   */
  reparent(id: string, parentId: string | null, options: { beforeId?: string | null; bone?: string } = {}): boolean {
    const node = this.node(id);
    if (!node || !canParent(this.nodes, id, parentId)) return false;
    if (options.beforeId === id) return true;
    const bone = this.node(parentId)?.type === 'character' ? options.bone : undefined;
    const local = node.type === 'item' ? null : this.hooks.localFor?.(id, parentId, bone);
    const rest = this.nodes.filter((entity) => entity !== node);
    const at = options.beforeId ? rest.findIndex((entity) => entity.id === options.beforeId) : -1;
    const next = at < 0 ? [...rest, node] : [...rest.slice(0, at), node, ...rest.slice(at)];
    const prepared = node.prepare({
      parentId,
      attachBone: bone,
      ...(node.type === 'item' ? { position: [...ZERO], rotation: [...ZERO], scale: [...ONE] } : local)
    });
    if (!prepared.size && next.every((entity, index) => this.nodes[index] === entity)) return true;
    this.record();
    this.commit();
    if (node.parentId) this.changedIds.add(node.parentId);
    node.apply(prepared);
    this.changedIds.add(id);
    if (parentId) this.changedIds.add(parentId);
    this.nodes = next;
    if (parentId) this.setExpanded(parentId, true);
    return true;
  }

  /** Wrap a node in a new group that takes its place. */
  group(id: string): string | null {
    const node = this.node(id);
    if (!node || node.type === 'item') return null;
    this.record();
    const group = createEntity({ type: 'group', name: uniqueName(this.nodes, node.parentId, 'Group'), attachBone: node.attachBone }, node.parentId);
    this.commit();
    node.link(group.id);
    this.changedIds.add(id);
    this.nodes = this.insert(this.nodes, group, id);
    this.select(group.id);
    this.setExpanded(group.id, true);
    return group.id;
  }

  // ----- selection ----------------------------------------------------------------------------------------

  select(id: string | null) {
    this.endGesture();
    this.selectedId = id;
    this.selectedBone = null;
  }

  selectBone(characterId: string, bone: string) {
    this.endGesture();
    this.selectedId = null;
    this.selectedBone = { characterId, bone };
  }

  setExpanded(key: string, open: boolean) {
    if (!!this.expanded[key] === open) return;
    this.expanded = { ...this.expanded, [key]: open };
  }

  toggle(key: string) {
    this.setExpanded(key, !this.expanded[key]);
  }

  private fixSelection() {
    if (this.selectedId && !this.node(this.selectedId)) this.selectedId = null;
    if (this.selectedBone && this.node(this.selectedBone.characterId)?.type !== 'character') this.selectedBone = null;
  }

  // ----- undo, persistence --------------------------------------------------------------------------------

  clear() {
    this.hooks.cancelLoad?.();
    if (this.nodes.length === 0) return;
    this.record();
    this.nodes = [];
    this.fixSelection();
  }

  undo() {
    this.hooks.cancelLoad?.();
    this.endGesture();
    const prev = this.history.undo(this.serializeNodes());
    if (prev !== null) this.restoreSerialized(prev);
  }

  redo() {
    this.hooks.cancelLoad?.();
    this.endGesture();
    const next = this.history.redo(this.serializeNodes());
    if (next !== null) this.restoreSerialized(next);
  }

  private restoreSerialized(text: string) {
    this.nodes = this.restoreAll(text);
    this.fixSelection();
    this.historyVersion++;
  }

  /** The scene as JSON: a version and the entities, each tagged with its `type`. */
  serialize(indent?: number): string {
    return JSON.stringify({ version: SCENE_VERSION, entities: this.nodes }, null, indent);
  }

  /** Replace the scene with restored entities (undoable unless this is the first document). */
  load(entities: Entity[], record = true) {
    this.endGesture();
    if (record) this.record();
    else {
      this.history.clear();
      this.historyVersion++;
    }
    this.nodes = entities;
    this.selectedId = null;
    this.selectedBone = null;
  }

  saveLocal(storage: Pick<Storage, 'setItem'>) {
    storage.setItem(SCENE_KEY, this.serialize());
  }

  /** The preset a character's look makes, to save as an outfit. */
  outfitOf(characterId: string) {
    const character = this.node(characterId);
    return character instanceof CharacterEntity ? character.captureOutfit(this.itemsOf(characterId)) : null;
  }
}
