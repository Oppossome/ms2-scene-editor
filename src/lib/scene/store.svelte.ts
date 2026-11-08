import { untrack } from 'svelte';
import {
  DEFAULT_SKIN,
  History,
  newId,
  ONE,
  parseSceneJson,
  SCENE_KEY,
  ZERO,
  type NodeKind,
  type SceneData,
  type SceneNode,
  type Vec3
} from './model.js';
import { canParent, cloneSubtree, deleteSubtree, moveNode, uniqueName } from './tree.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface NewNode {
  kind: NodeKind;
  name: string;
  parentId?: string | null;
  /** Parent given as an index into the same `addMany` batch (the parent must come first). */
  parentIndex?: number;
  attachBone?: string;
  beforeId?: string | null;
  glb?: string;
  mapId?: string;
  gender?: 0 | 1;
  skin?: number;
  itemId?: string;
  color?: number;
  slots?: string[];
  clip?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

export interface NewItem {
  itemId: string;
  name: string;
  slots: string[];
  color?: number;
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

const toNode = (spec: NewNode, parentId: string | null): SceneNode => {
  const node: SceneNode = {
    id: newId(),
    kind: spec.kind,
    name: spec.name,
    parentId,
    position: spec.position ?? [...ZERO],
    rotation: spec.rotation ?? [...ZERO],
    scale: spec.scale ?? [...ONE],
    visible: true,
    locked: false
  };
  if (spec.attachBone) node.attachBone = spec.attachBone;
  if (spec.glb) node.glb = spec.glb;
  if (spec.mapId) node.mapId = spec.mapId;
  if (spec.kind === 'character') {
    node.gender = spec.gender ?? 1;
    node.skin = spec.skin ?? DEFAULT_SKIN;
  }
  if (spec.kind === 'item') {
    node.itemId = spec.itemId;
    node.slots = spec.slots ?? [];
    if (spec.color !== undefined) node.color = spec.color;
  }
  if (spec.clip) node.clip = spec.clip;
  return node;
};

/** Where a new node may go within `list`: items need a character parent, nothing lives on an item. */
function parentIn(list: SceneNode[], spec: NewNode): string | null | undefined {
  const parentId = spec.parentId ?? null;
  const parent = parentId ? list.find((n) => n.id === parentId) : undefined;
  if (spec.kind === 'item') return parent?.kind === 'character' ? parentId : undefined;
  if (parentId && (!parent || parent.kind === 'item')) return null;
  return parentId;
}

/** The scene being edited: the node tree, selection, undo/redo and persistence. */
export class SceneState {
  nodes = $state.raw<SceneNode[]>([]);
  selectedId = $state<string | null>(null);
  selectedBone = $state.raw<BoneSelection | null>(null);
  mode = $state<GizmoMode>('translate');
  snap = $state(false);
  /** Explorer open state by key (node id, or `skel:<characterId>` / `bone:<characterId>:<name>`). */
  expanded = $state.raw<Record<string, boolean>>({});

  /** Filled in by the renderer: the local transform a node needs to keep its world pose under a new parent. */
  hooks: { localFor?: (id: string, parentId: string | null, bone?: string) => LocalTransform | null } = {};

  private history = new History(100);
  /** Bumped on every history change so the UI can reflect canUndo/canRedo. */
  historyVersion = $state(0);
  private indexCache: { nodes: SceneNode[]; map: Map<string, SceneNode> } | null = null;

  get byId(): Map<string, SceneNode> {
    if (this.indexCache?.nodes !== this.nodes) {
      this.indexCache = { nodes: this.nodes, map: new Map(this.nodes.map((n) => [n.id, n])) };
    }
    return this.indexCache.map;
  }

  node(id: string | null | undefined): SceneNode | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  get selected(): SceneNode | undefined {
    return this.node(this.selectedId);
  }

  get canUndo() {
    void this.historyVersion;
    return this.history.canUndo;
  }

  get canRedo() {
    void this.historyVersion;
    return this.history.canRedo;
  }

  /** Remember the current state so the next change can be undone. */
  record() {
    this.history.record(JSON.stringify(this.nodes));
    untrack(() => this.historyVersion++);
  }

  private insert(list: SceneNode[], node: SceneNode, beforeId?: string | null): SceneNode[] {
    const at = beforeId ? list.findIndex((n) => n.id === beforeId) : -1;
    return at < 0 ? [...list, node] : [...list.slice(0, at), node, ...list.slice(at)];
  }

  add(spec: NewNode, select = true): string {
    const parentId = parentIn(this.nodes, spec);
    if (parentId === undefined) return '';
    this.record();
    const node = toNode({ ...spec, name: uniqueName(this.nodes, parentId, spec.name) }, parentId);
    if (node.attachBone && this.node(parentId)?.kind !== 'character') delete node.attachBone;
    this.nodes = this.insert(this.nodes, node, spec.beforeId);
    if (select) this.select(node.id);
    if (parentId) this.setExpanded(parentId, true);
    return node.id;
  }

  /** Add several nodes in one undo step (no selection change). Returns their ids. */
  addMany(specs: NewNode[]): string[] {
    this.record();
    let list = this.nodes;
    const ids: string[] = [];
    for (const spec of specs) {
      const parentRef = spec.parentIndex !== undefined ? (ids[spec.parentIndex] || null) : undefined;
      const parentId = parentIn(list, parentRef !== undefined ? { ...spec, parentId: parentRef } : spec);
      if (parentId === undefined) {
        ids.push('');
        continue;
      }
      const node = toNode(spec, parentId);
      list = [...list, node];
      ids.push(node.id);
    }
    this.nodes = list;
    return ids;
  }

  /** Wear an item: a child item node of the character. Items in the same slots (or the same item) are replaced. */
  equipItem(characterId: string, item: NewItem, select = true): string {
    const character = this.node(characterId);
    if (!character || character.kind !== 'character') return '';
    this.record();
    const clash = (n: SceneNode) =>
      n.parentId === characterId &&
      n.kind === 'item' &&
      (n.itemId === item.itemId || (n.slots ?? []).some((s) => item.slots.includes(s)));
    const kept = this.nodes.filter((n) => !clash(n));
    const node = toNode(
      { kind: 'item', name: item.name, itemId: item.itemId, slots: item.slots, color: item.color, attachBone: item.attachBone },
      characterId
    );
    this.nodes = this.insert(kept, node);
    if (select) this.select(node.id);
    this.setExpanded(characterId, true);
    return node.id;
  }

  /** Replace everything a character wears (one undo step). */
  setOutfit(characterId: string, items: NewItem[]) {
    const character = this.node(characterId);
    if (!character || character.kind !== 'character') return;
    this.record();
    const kept = this.nodes.filter((n) => !(n.parentId === characterId && n.kind === 'item'));
    const added = items.map((i) =>
      toNode({ kind: 'item', name: i.name, itemId: i.itemId, slots: i.slots, color: i.color }, characterId)
    );
    this.nodes = [...kept, ...added];
    this.setExpanded(characterId, true);
  }

  /** A character with its outfit, in one undo step. */
  addCharacter(
    spec: { name: string; gender: 0 | 1; skin?: number; parentId?: string | null; position?: Vec3 },
    items: NewItem[] = []
  ): string {
    const parentId = parentIn(this.nodes, { kind: 'character', name: spec.name, parentId: spec.parentId });
    if (parentId === undefined) return '';
    this.record();
    const character = toNode(
      {
        kind: 'character',
        name: uniqueName(this.nodes, parentId, spec.name),
        gender: spec.gender,
        skin: spec.skin,
        position: spec.position
      },
      parentId
    );
    const children = items.map((i) =>
      toNode({ kind: 'item', name: i.name, itemId: i.itemId, slots: i.slots, color: i.color }, character.id)
    );
    this.nodes = [...this.nodes, character, ...children];
    this.select(character.id);
    this.setExpanded(character.id, true);
    if (parentId) this.setExpanded(parentId, true);
    return character.id;
  }

  remove(id: string) {
    if (!this.node(id)) return;
    this.record();
    this.nodes = deleteSubtree(this.nodes, id);
    this.fixSelection();
  }

  /** Copy a node with everything below it (not items: a character holds one of each). */
  duplicate(id: string): string | null {
    const src = this.node(id);
    if (!src || src.kind === 'item') return null;
    const copies = cloneSubtree(this.nodes, id);
    if (!copies.length) return null;
    this.record();
    const root = copies[0];
    root.name = uniqueName(this.nodes, root.parentId, `${src.name} copy`);
    root.position = [src.position[0] + 60, src.position[1], src.position[2] + 60];
    this.nodes = [...this.nodes, ...copies];
    this.select(root.id);
    return root.id;
  }

  /** Change a node. Pass record=false for continuous edits (dragging) after a manual record(). */
  update(id: string, patch: Partial<Omit<SceneNode, 'id'>>, record = true) {
    if (!this.node(id)) return;
    if (record) this.record();
    this.nodes = this.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
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
    const parent = this.node(parentId);
    const bone = parent?.kind === 'character' ? options.bone : undefined;
    const local = node.kind === 'item' ? null : this.hooks.localFor?.(id, parentId, bone);
    this.record();
    let next = moveNode(this.nodes, id, parentId, { beforeId: options.beforeId, bone });
    if (node.kind === 'item') {
      next = next.map((n) =>
        n.id === id ? { ...n, position: [...ZERO] as Vec3, rotation: [...ZERO] as Vec3, scale: [...ONE] as Vec3 } : n
      );
    } else if (local) {
      next = next.map((n) => (n.id === id ? { ...n, ...local } : n));
    }
    this.nodes = next;
    if (parentId) this.setExpanded(parentId, true);
    return true;
  }

  /** Wrap a node in a new group that takes its place. */
  group(id: string): string | null {
    const node = this.node(id);
    if (!node || node.kind === 'item') return null;
    this.record();
    const group = toNode({ kind: 'group', name: uniqueName(this.nodes, node.parentId, 'Group') }, node.parentId);
    if (node.attachBone) group.attachBone = node.attachBone;
    this.nodes = this.insert(this.nodes, group, id).map((n) => {
      if (n.id !== id) return n;
      const { attachBone: _bone, ...rest } = n;
      return { ...rest, parentId: group.id };
    });
    this.select(group.id);
    this.setExpanded(group.id, true);
    return group.id;
  }

  select(id: string | null) {
    this.selectedId = id;
    this.selectedBone = null;
  }

  selectBone(characterId: string, bone: string) {
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

  clear() {
    if (this.nodes.length === 0) return;
    this.record();
    this.nodes = [];
    this.fixSelection();
  }

  undo() {
    const prev = this.history.undo(JSON.stringify(this.nodes));
    if (prev === null) return;
    this.restoreSerialized(prev);
  }

  redo() {
    const next = this.history.redo(JSON.stringify(this.nodes));
    if (next === null) return;
    this.restoreSerialized(next);
  }

  private restoreSerialized(text: string) {
    this.nodes = JSON.parse(text) as SceneNode[];
    this.fixSelection();
    this.historyVersion++;
  }

  private fixSelection() {
    if (this.selectedId && !this.node(this.selectedId)) this.selectedId = null;
    if (this.selectedBone && this.node(this.selectedBone.characterId)?.kind !== 'character') this.selectedBone = null;
  }

  toData(): SceneData {
    return { version: 1, nodes: JSON.parse(JSON.stringify(this.nodes)) as SceneNode[] };
  }

  /** Replace the scene with loaded data (undoable). */
  load(data: SceneData) {
    this.record();
    this.nodes = data.nodes;
    this.selectedId = null;
    this.selectedBone = null;
  }

  loadJson(text: string): boolean {
    const data = parseSceneJson(text);
    if (!data) return false;
    this.load(data);
    return true;
  }

  saveLocal(storage: Pick<Storage, 'setItem'>) {
    storage.setItem(SCENE_KEY, JSON.stringify(this.toData()));
  }

  loadLocal(storage: Pick<Storage, 'getItem'>) {
    const raw = storage.getItem(SCENE_KEY);
    const data = raw ? parseSceneJson(raw) : null;
    if (data) {
      this.nodes = data.nodes;
      this.history.clear();
      this.historyVersion++;
    }
  }
}
