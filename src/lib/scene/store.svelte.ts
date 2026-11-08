import { untrack } from 'svelte';
import type { Object3D } from 'three';
import type { AnimationPlayer } from '../assets/animation.js';
import type { OutfitSnapshot } from '../stores/outfits.js';
import {
  History,
  newId,
  parseSceneJson,
  SCENE_KEY,
  type ObjectKind,
  type SceneData,
  type SceneObject,
  type Vec3
} from './model.js';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface NewObject {
  kind: ObjectKind;
  name: string;
  glb?: string;
  mapId?: string;
  outfit?: OutfitSnapshot;
  clip?: string;
  position?: Vec3;
  scale?: Vec3;
}

/** The scene being edited: objects, selection, undo/redo and persistence. */
export class SceneState {
  objects = $state.raw<SceneObject[]>([]);
  selectedId = $state<string | null>(null);
  mode = $state<GizmoMode>('translate');
  snap = $state(false);
  /** Clip names each object can play, filled in by the objects once their model is loaded. */
  clipNames = $state.raw<Record<string, string[]>>({});

  /** Loaded three.js groups by object id (for the transform gizmo). */
  readonly groups = new Map<string, Object3D>();
  groupVersion = $state(0);
  /** Animation players by object id, so the playing clip can be exported. */
  readonly players = new Map<string, AnimationPlayer>();

  private history = new History(100);
  /** Bumped on every history change so the UI can reflect canUndo/canRedo. */
  historyVersion = $state(0);

  get selected(): SceneObject | undefined {
    return this.objects.find((o) => o.id === this.selectedId);
  }

  get selectedGroup(): Object3D | undefined {
    void this.groupVersion;
    return this.selectedId ? this.groups.get(this.selectedId) : undefined;
  }

  get canUndo() {
    void this.historyVersion;
    return this.history.canUndo;
  }

  get canRedo() {
    void this.historyVersion;
    return this.history.canRedo;
  }

  registerGroup(id: string, group: Object3D | null) {
    if (group) this.groups.set(id, group);
    else this.groups.delete(id);
    // Called from effects: bump without subscribing to the counter.
    untrack(() => this.groupVersion++);
  }

  registerPlayer(id: string, player: AnimationPlayer | null) {
    if (player) this.players.set(id, player);
    else this.players.delete(id);
  }

  /** Remember the current state so the next change can be undone. */
  record() {
    this.history.record(JSON.stringify(this.objects));
    untrack(() => this.historyVersion++);
  }

  add(spec: NewObject, select = true): string {
    this.record();
    const obj: SceneObject = {
      id: newId(),
      kind: spec.kind,
      name: spec.name,
      glb: spec.glb,
      mapId: spec.mapId,
      outfit: spec.outfit,
      clip: spec.clip,
      position: spec.position ?? [0, 0, 0],
      rotation: [0, 0, 0],
      scale: spec.scale ?? [1, 1, 1],
      visible: true
    };
    this.objects = [...this.objects, obj];
    if (select) this.selectedId = obj.id;
    return obj.id;
  }

  /** Add several objects in one undo step (no selection change). */
  addMany(specs: (NewObject & { rotation?: Vec3 })[]) {
    this.record();
    const added = specs.map<SceneObject>((spec) => ({
      id: newId(),
      kind: spec.kind,
      name: spec.name,
      glb: spec.glb,
      mapId: spec.mapId,
      outfit: spec.outfit,
      clip: spec.clip,
      position: spec.position ?? [0, 0, 0],
      rotation: spec.rotation ?? [0, 0, 0],
      scale: spec.scale ?? [1, 1, 1],
      visible: true
    }));
    this.objects = [...this.objects, ...added];
  }

  remove(id: string) {
    if (!this.objects.some((o) => o.id === id)) return;
    this.record();
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.selectedId === id) this.selectedId = null;
  }

  duplicate(id: string): string | null {
    const src = this.objects.find((o) => o.id === id);
    if (!src) return null;
    this.record();
    const copy: SceneObject = {
      ...structuredClone($state.snapshot(src)),
      id: newId(),
      name: `${src.name} copy`,
      position: [src.position[0] + 60, src.position[1], src.position[2] + 60]
    };
    this.objects = [...this.objects, copy];
    this.selectedId = copy.id;
    return copy.id;
  }

  /** Change an object. Pass record=false for continuous edits (dragging) after a manual record(). */
  update(id: string, patch: Partial<Omit<SceneObject, 'id'>>, record = true) {
    if (!this.objects.some((o) => o.id === id)) return;
    if (record) this.record();
    this.objects = this.objects.map((o) => (o.id === id ? { ...o, ...patch } : o));
  }

  select(id: string | null) {
    this.selectedId = id;
  }

  clear() {
    if (this.objects.length === 0) return;
    this.record();
    this.objects = [];
    this.selectedId = null;
  }

  undo() {
    const prev = this.history.undo(JSON.stringify(this.objects));
    if (prev === null) return;
    this.restoreSerialized(prev);
  }

  redo() {
    const next = this.history.redo(JSON.stringify(this.objects));
    if (next === null) return;
    this.restoreSerialized(next);
  }

  private restoreSerialized(text: string) {
    this.objects = JSON.parse(text) as SceneObject[];
    if (this.selectedId && !this.objects.some((o) => o.id === this.selectedId)) this.selectedId = null;
    this.historyVersion++;
  }

  toData(): SceneData {
    return { version: 1, objects: JSON.parse(JSON.stringify(this.objects)) as SceneObject[] };
  }

  /** Replace the scene with loaded data (undoable). */
  load(data: SceneData) {
    this.record();
    this.objects = data.objects;
    this.selectedId = null;
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
      this.objects = data.objects;
      this.history.clear();
      this.historyVersion++;
    }
  }
}
