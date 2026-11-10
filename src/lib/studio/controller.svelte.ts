import { getItem } from '../character/build.js';
import { downloadBuffer, safeFilename } from '../export/glb.js';
import { composeMap, expandLegacyMaps, fetchMap } from '../maps/entities.js';
import type { ViewApi } from '../components/viewapi.js';
import { defaultInsertParent, itemTargetCharacter } from '../scene/insert.js';
import { DEFAULT_EYE, DEFAULT_SKIN, SCENE_KEY, type Vec3 } from '../scene/model.js';
import { parseSceneJson } from '../scene/document.js';
import { restoreEntity, CharacterEntity, GroupEntity, RiggedModel } from '../scene/entity.svelte.js';
import { SceneRuntime } from '../scene/runtime.svelte.js';
import { SceneState, type NewItem } from '../scene/store.svelte.js';
import { saveNamed, type OutfitSnapshot } from '../stores/outfits.js';
import type { ChannelIndexes } from '../character/tint.js';
import type { ItemRecord, MapEnvironment } from '../types.js';
import { DEFAULT_VIEW, resolveEnvironment, type ViewSettings } from '../scene/environment.js';
import { lastFrame, stepFrame } from '../scene/properties.js';
import { pathOf } from '../scene/tree.js';

/** Frame steps closer together than this belong to one undo step. */
const STEP_BURST_MS = 800;

/** What a context menu or the Add Child panel is about. */
export type MenuTarget = { type: 'node'; id: string } | { type: 'bone'; characterId: string; bone: string } | { type: 'empty' };

export interface MenuState {
  x: number;
  y: number;
  target: MenuTarget;
}

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a divider above this entry. */
  separator?: boolean;
  /** A switch: shows a check mark when on (leave out for plain commands). */
  checked?: boolean;
}

export interface AddTarget {
  nodeId: string;
  /** Mount the new child on this bone of the character. */
  bone?: string;
}

export interface ModelEntry {
  name: string;
  glb: string;
  scale?: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The studio's document and UI state, and the actions that touch several parts of it (scene data, the three.js
 * runtime, storage, files). Components call these instead of juggling the store and the runtime themselves.
 */
export class Studio {
  readonly store = new SceneState();
  readonly runtime = new SceneRuntime();
  readonly view: ViewApi = {};

  menu = $state.raw<MenuState | null>(null);
  message = $state('');
  busy = $state('');
  autosaveBlocked = $state(false);
  /** Node being renamed in the Explorer. */
  renaming = $state<string | null>(null);
  ready = $state(false);
  /** True while the transform gizmo is being used, so a click on it does not change the selection. */
  gizmoActive = false;
  /** Toolbox: insert at the scene root instead of under the selected node. */
  insertAtRoot = $state(false);
  /** Toolbox: height in pixels of the preview pane. */
  previewHeight = $state(260);
  /** The ground grid of the main viewport. */
  showGrid = $state(true);
  /** Backdrop and fog of the main viewport (View menu). */
  look = $state<ViewSettings>({ ...DEFAULT_VIEW });
  /** The backdrop picker is open. */
  pickingBackdrop = $state(false);
  /** The About dialog is open. */
  showAbout = $state(false);
  /** The Keybinds dialog is open. */
  showKeybinds = $state(false);
  /** The Report an issue dialog is open. */
  showReportIssue = $state(false);
  /** Toolbox (the left dock): shown or hidden. */
  toolboxOpen = $state(true);
  /** Bumped to ask the Toolbox to put the cursor in its search box. */
  toolboxFocus = $state(0);
  /** Toolbox: current tab. */
  toolboxTab = $state<'props' | 'npcs' | 'maps' | 'characters' | 'items'>('props');

  /**
   * The node the Toolbox last inserted and the parent it used. Inserting selects the new node, which would
   * otherwise make the next insert land inside it; while that node stays selected the same parent is reused.
   */
  private lastInsert: { id: string; parent: string | null; bone?: string } | null = null;

  constructor() {
    this.store.hooks.localFor = (id, parentId, bone) => this.runtime.localFor(id, parentId, bone);
    this.store.hooks.cancelLoad = () => this.documentLoad?.abort();
    this.runtime.hooks.defaultClip = (id, clip) => this.store.update(id, { clip }, false);
    this.runtime.hooks.error = (message) => { this.message = message; };
  }

  // ----- Toolbox inserts ---------------------------------------------------------------------------------------

  /**
   * Parent the Toolbox inserts into: the selected node if it can hold children, the character of a selected bone,
   * else the scene root.
   */
  get insertParentId(): string | null {
    if (this.insertAtRoot) return null;
    const last = this.lastInsert;
    if (last && this.store.selectedId === last.id) return this.store.node(last.parent) ? last.parent : null;
    const bone = this.store.selectedBone;
    if (bone && this.store.node(bone.characterId)) return bone.characterId;
    return defaultInsertParent(this.store.nodes, this.store.selectedId);
  }

  /** Bone of the parent character that models and items are mounted on (a selected bone, or the last one used). */
  get insertBone(): string | undefined {
    if (this.insertAtRoot) return undefined;
    const last = this.lastInsert;
    if (last && this.store.selectedId === last.id) return last.bone;
    return this.store.selectedBone?.bone;
  }

  /** Where the Toolbox will insert, for display. */
  get insertPath(): string {
    const id = this.insertParentId;
    if (!id) return 'Scene root';
    const path = pathOf(this.store.nodes, id).join(' / ');
    const bone = this.insertBone;
    return bone ? `${path} / ${bone.replace(/_/g, ' ')}` : path;
  }

  private inserted(id: string, parent: string | null, bone?: string): string {
    if (id) this.lastInsert = { id, parent, bone };
    return id;
  }

  insertModel(entry: ModelEntry, type: 'prop' | 'npc'): string {
    const parent = this.insertParentId;
    const bone = this.insertBone;
    return this.inserted(this.addModel(entry, type, { parentId: parent ?? undefined, bone }), parent, bone);
  }

  async insertMap(entry: { id: string; name: string }): Promise<string> {
    const parent = this.insertParentId;
    const bone = this.insertBone;
    return this.inserted(await this.addMap(entry, parent ?? undefined, bone), parent, bone);
  }

  async insertCharacter(name: string, snapshot: OutfitSnapshot): Promise<string> {
    const parent = this.insertParentId;
    return this.inserted(await this.addCharacter(name, snapshot, parent ?? undefined), parent);
  }

  /** The character an item inserted from the Toolbox is worn by (null: it goes on a new character). */
  get itemTarget() {
    if (this.insertAtRoot) return null;
    const bone = this.store.selectedBone;
    if (bone) {
      const character = this.store.node(bone.characterId);
      return character instanceof CharacterEntity ? character : null;
    }
    return itemTargetCharacter(this.store.nodes, this.store.selectedId);
  }

  /** Wear an item on the targeted character, or put it on a new base character of the given gender. */
  insertItem(item: ItemRecord, gender: 0 | 1, color?: number, channelColors?: ChannelIndexes): string {
    const target = this.itemTarget;
    if (target) {
      const parent = this.insertParentId;
      const bone = this.insertBone;
      return this.inserted(this.commitItem({ nodeId: target.id, bone }, item, color, channelColors), parent, bone);
    }
    const parent = this.insertParentId;
    const id = this.store.addCharacter(
      { name: gender === 1 ? 'Female' : 'Male', gender, skin: DEFAULT_SKIN, parentId: parent, position: parent ? [0, 0, 0] : this.spawnPoint() },
      [{ itemId: item.id, name: item.name, slots: item.slots, color, channelColors }]
    );
    return this.inserted(id, parent);
  }

  // ----- adding ------------------------------------------------------------------------------------------------

  /** New things appear on the ground where the camera looks, fanned out so they do not pile up. */
  spawnPoint(): Vec3 {
    const t = this.view.target?.();
    // Count only top-level nodes: the contents of a group or a character do not take up room on the ground.
    const n = this.store.nodes.filter((x) => x.parentId === null).length;
    const dx = ((n % 6) - 2.5) * 110;
    const dz = Math.floor(n / 6) * 110;
    return [round((t?.x ?? 0) + dx), 0, round((t?.z ?? 0) + dz)];
  }

  addModel(entry: ModelEntry, type: 'prop' | 'npc', where: { parentId?: string; bone?: string } = {}): string {
    const s = entry.scale ?? 1;
    return this.store.add({
      type,
      name: entry.name,
      glb: entry.glb,
      parentId: where.parentId,
      attachBone: where.bone,
      position: where.parentId ? [0, 0, 0] : this.spawnPoint(),
      scale: [s, s, s]
    });
  }

  private documentLoad: AbortController | null = null;

  async addMap(entry: { id: string; name: string }, parentId?: string, attachBone?: string): Promise<string> {
    this.documentLoad?.abort();
    const request = this.documentLoad = new AbortController();
    const revision = this.store.revision;
    this.busy = 'map';
    this.message = '';
    try {
      const data = await fetchMap(entry.id, request.signal);
      if (request.signal.aborted || revision !== this.store.revision) {
        this.message = 'Map insertion cancelled because the scene changed.';
        return '';
      }
      const group = restoreEntity({
        type: 'group', name: entry.name, parentId: parentId ?? null, attachBone, mapId: data.id,
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]
      });
      const id = group.id;
      this.store.append([group, ...composeMap(group as GroupEntity, data)]);
      this.store.select(id);
      this.store.setExpanded(id, false);
      this.message = `Added ${data.items.length} props${data.unresolved ? `; ${data.unresolved} nonrenderable/unresolved records omitted` : ''}.`;
      return id;
    } catch (error) {
      if (!request.signal.aborted) this.message = `Could not load map: ${error instanceof Error ? error.message : error}`;
      return '';
    } finally { if (this.documentLoad === request) this.busy = ''; }
  }

  addGroup(parentId?: string): string {
    return this.store.add({ type: 'group', name: 'Group', parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() });
  }
  addLighting(parentId?: string): string {
    return this.store.add({ type: 'lighting', name: 'Lighting', parentId, environment: {} });
  }

  async outfitItems(snapshot: OutfitSnapshot): Promise<NewItem[]> {
    const records = await Promise.all(snapshot.items.map((e) => getItem(e.id)));
    const out: NewItem[] = [];
    records.forEach((record, i) => {
      if (record) {
        const entry = snapshot.items[i];
        out.push({ itemId: record.id, name: record.name, slots: record.slots, color: entry.color, channelColors: entry.channels });
      }
    });
    return out;
  }

  async addCharacter(name: string, snapshot: OutfitSnapshot, parentId?: string): Promise<string> {
    const items = await this.outfitItems(snapshot);
    return this.store.addCharacter(
      { name, gender: snapshot.gender, skin: snapshot.skin, eye: snapshot.eye, expression: snapshot.expression, parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() },
      items
    );
  }

  addBaseCharacter(gender: 0 | 1, parentId?: string): string {
    return this.store.addCharacter(
      { name: gender === 1 ? 'Female' : 'Male', gender, skin: DEFAULT_SKIN, parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() },
      []
    );
  }

  /** Make a character wear a saved outfit (one undo step per change; gender, skin and eyes follow the outfit). */
  async applyOutfit(characterId: string, snapshot: OutfitSnapshot) {
    const character = this.store.node(characterId);
    if (character?.type !== 'character') return;
    const items = await this.outfitItems(snapshot);
    const eye = snapshot.eye ?? DEFAULT_EYE;
    this.store.transaction(() => {
      this.store.update(characterId, { gender: snapshot.gender, skin: snapshot.skin, eye, expression: snapshot.expression });
      this.store.setOutfit(characterId, items);
    });
  }

  /** Wear an item: it becomes a child of the character (optionally mounted on a bone). */
  commitItem(target: AddTarget, item: ItemRecord, color?: number, channelColors?: ChannelIndexes): string {
    return this.store.equipItem(target.nodeId, {
      itemId: item.id,
      name: item.name,
      slots: item.slots,
      color,
      channelColors,
      attachBone: target.bone
    });
  }

  saveOutfit(characterId: string, name: string): boolean {
    const snapshot = this.store.outfitOf(characterId);
    const trimmed = name.trim();
    if (!snapshot || !trimmed) return false;
    saveNamed(localStorage, trimmed, snapshot);
    return true;
  }

  // ----- files -------------------------------------------------------------------------------------------------

  /** Export a node with everything below it, or the whole scene (static pose, no maps) when `id` is null. */
  async exportGlb(id: string | null) {
    this.busy = 'export';
    this.message = '';
    try {
      const buffer = await this.runtime.exportGlb(id, id !== null);
      if (!buffer) {
        this.message = 'Nothing to export.';
        return;
      }
      downloadBuffer(buffer, safeFilename(id ? (this.store.node(id)?.name ?? 'export') : 'scene'));
    } catch (e) {
      this.message = `Export failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.busy = '';
    }
  }

  exportJson() {
    const blob = new Blob([this.store.serialize(2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importJson(file: File) {
    await this.loadDocument(await file.text());
  }

  private async loadDocument(text: string, initial = false): Promise<boolean> {
    if (initial) this.autosaveBlocked = true;
    this.documentLoad?.abort();
    const request = this.documentLoad = new AbortController();
    const issues: string[] = [];
    const parsed = parseSceneJson(text, issues);
    if (!parsed) {
      if (initial) this.autosaveBlocked = true;
      this.message = `Cannot load scene: ${issues.join('; ')}`;
      return false;
    }
    const revision = this.store.revision;
    this.busy = 'scene';
    try {
      const entities = await expandLegacyMaps(parsed, request.signal);
      if (request.signal.aborted || revision !== this.store.revision) {
        this.message = 'Scene loading cancelled because the document changed.';
        return false;
      }
      this.store.load(entities, !initial);
      this.autosaveBlocked = false;
      this.message = issues.length ? `Loaded with repairs: ${issues.join('; ')}` : '';
      return true;
    } catch (error) {
      if (initial) this.autosaveBlocked = true;
      if (!request.signal.aborted) this.message = `Cannot load scene; original save preserved: ${error instanceof Error ? error.message : error}`;
      return false;
    } finally { if (this.documentLoad === request) this.busy = ''; }
  }

  async restoreLocal(storage: Pick<Storage, 'getItem'>): Promise<boolean> {
    const raw = storage.getItem(SCENE_KEY);
    return raw ? this.loadDocument(raw, true) : true;
  }

  /** What the main viewport draws behind and around the scene: the View settings applied to the scene's map. */
  get environment(): MapEnvironment {
    return resolveEnvironment(this.look, this.runtime.mapEnvironment());
  }

  // ----- animation frame ------------------------------------------------------------------------------------------

  private lastStep = { id: '', at: 0 };

  /** Hold a node's animation on a frame (kept inside its clip). `record` is false while a drag already made its undo step. */
  setFrame(id: string, frame: number, record = true) {
    const node = this.store.node(id);
    if (!node) return;
    if (!(node instanceof RiggedModel)) return;
    const last = lastFrame(this.runtime.clipsOf(id), node.clip);
    const next = Math.max(0, Math.round(last === undefined ? frame : Math.min(frame, last)));
    this.store.update(id, { freeze: next }, record);
  }

  /**
   * Step a node's animation by whole frames from where it is, holding it there. Steps in quick succession on one
   * node make a single undo step, so stepping through a clip does not fill the history.
   */
  stepFrame(id: string, delta: number) {
    const node = this.store.node(id);
    const clips = this.runtime.clipsOf(id);
    if (!(node instanceof RiggedModel) || !clips.length) return;
    const frame = stepFrame(node.freeze ?? this.runtime.currentFrame(id), delta, lastFrame(clips, node.clip));
    this.setFrame(id, frame, !this.inBurst(id));
  }

  /** Hold a node on a frame from a control that fires in quick succession (keys on the slider): one undo step per burst. */
  holdFrame(id: string, frame: number) {
    this.setFrame(id, frame, !this.inBurst(id));
  }

  /** True when the previous frame edit was on this node a moment ago; notes this edit for the next call. */
  inBurst(id: string): boolean {
    const now = performance.now();
    const burst = this.lastStep.id === id && now - this.lastStep.at < STEP_BURST_MS;
    this.lastStep = { id, at: now };
    return burst;
  }

  // ----- view helpers --------------------------------------------------------------------------------------------

  focus(id: string | null) {
    const target = id ? this.runtime.boundsOf(id) : undefined;
    if (target) this.view.frame?.(target);
  }

  toggleVisible(id: string) {
    const node = this.store.node(id);
    if (node) this.store.update(id, { visible: !node.visible });
  }

  toggleLocked(id: string) {
    const node = this.store.node(id);
    if (node) this.store.update(id, { locked: !node.locked });
  }

  centerGroup(id: string): boolean {
    const positions = this.runtime.groupCenterPositions(id);
    if (!positions) return false;
    this.store.updatePositions(positions);
    return true;
  }

  // ----- Add Child and menus --------------------------------------------------------------------------------------

  /** Show the Toolbox and put the cursor in its search box. */
  openToolbox() {
    this.toolboxOpen = true;
    this.toolboxFocus++;
  }

  /**
   * "Add Child...": select the node (or bone) and show the Toolbox, which inserts into the selection and previews
   * items on it. A character (or one of its bones) opens the Items tab.
   */
  addChild(nodeId: string, bone?: string) {
    this.menu = null;
    if (bone) this.store.selectBone(nodeId, bone);
    else this.store.select(nodeId);
    this.insertAtRoot = false;
    const wearable = bone !== undefined || this.store.node(nodeId)?.type === 'character';
    if (wearable) this.toolboxTab = 'items';
    else if (this.toolboxTab === 'items') this.toolboxTab = 'props';
    this.openToolbox();
  }

  openMenu(x: number, y: number, target: MenuTarget) {
    this.menu = { x, y, target };
  }

  closeMenu() {
    this.menu = null;
  }

  /** Entries of the context menu for a node, a bone or empty space. */
  menuItems(target: MenuTarget): MenuItem[] {
    const store = this.store;
    if (target.type === 'bone') {
      return [
        { label: 'Add Child...', action: () => this.addChild(target.characterId, target.bone) },
        { label: 'Select', action: () => store.selectBone(target.characterId, target.bone) }
      ];
    }
    if (target.type === 'empty') {
      return [
        { label: 'Add Group', action: () => this.addGroup() },
        { label: 'Add Lighting', action: () => this.addLighting() },
        { label: 'Add Female character', action: () => this.addBaseCharacter(1) },
        { label: 'Add Male character', action: () => this.addBaseCharacter(0) }
      ];
    }
    const node = store.node(target.id);
    if (!node) return [];
    const id = node.id;
    const item = node.type === 'item';
    return [
      { label: 'Add Child...', action: () => this.addChild(id), disabled: item || node.type === 'lighting' },
      { label: 'Rename', action: () => (this.renaming = id) },
      { label: 'Focus', action: () => this.focus(id), disabled: node.type === 'lighting' },
      { label: 'Duplicate', action: () => store.duplicate(id), disabled: item, separator: true },
      { label: 'Group', action: () => store.group(id), disabled: item },
      { label: 'Unparent', action: () => store.reparent(id, null), disabled: item || node.parentId === null },
      { label: node.visible ? 'Hide' : 'Show', action: () => this.toggleVisible(id), separator: true },
      { label: node.locked ? 'Unlock' : 'Lock', action: () => this.toggleLocked(id) },
      { label: 'Export GLB', action: () => void this.exportGlb(id), disabled: item || (node instanceof GroupEntity && !!node.mapId) || node.type === 'lighting' },
      { label: 'Delete', action: () => store.remove(id), danger: true, separator: true }
    ];
  }

  dispose() {
    this.documentLoad?.abort();
    this.runtime.dispose();
  }
}
