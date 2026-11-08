import { getItem } from '../character/build.js';
import { downloadBuffer, safeFilename } from '../export/glb.js';
import { decomposeForScene, extractNearby } from '../maps/extract.js';
import type { ViewApi } from '../components/viewapi.js';
import { DEFAULT_SKIN, nodesToOutfit, type Vec3 } from '../scene/model.js';
import { SceneRuntime } from '../scene/runtime.svelte.js';
import { SceneState, type NewItem } from '../scene/store.svelte.js';
import { saveNamed, type OutfitSnapshot } from '../stores/outfits.js';
import type { ItemRecord, MapData } from '../types.js';
import { Vector3 } from 'three';

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
const EXTRACT_LIMIT = 300;

/**
 * The studio's document and UI state, and the actions that touch several parts of it (scene data, the three.js
 * runtime, storage, files). Components call these instead of juggling the store and the runtime themselves.
 */
export class Studio {
  readonly store = new SceneState();
  readonly runtime = new SceneRuntime();
  readonly view: ViewApi = {};

  addTarget = $state.raw<AddTarget | null>(null);
  menu = $state.raw<MenuState | null>(null);
  message = $state('');
  busy = $state('');
  /** Node being renamed in the Explorer. */
  renaming = $state<string | null>(null);
  ready = $state(false);
  /** True while the transform gizmo is being used, so a click on it does not change the selection. */
  gizmoActive = false;

  constructor() {
    this.store.hooks.localFor = (id, parentId, bone) => this.runtime.localFor(id, parentId, bone);
    this.runtime.hooks.defaultClip = (id, clip) => this.store.update(id, { clip }, false);
  }

  // ----- adding ------------------------------------------------------------------------------------------------

  /** New things appear on the ground where the camera looks, fanned out so they do not pile up. */
  spawnPoint(): Vec3 {
    const t = this.view.target?.();
    const n = this.store.nodes.length;
    const dx = ((n % 6) - 2.5) * 110;
    const dz = Math.floor(n / 6) * 110;
    return [round((t?.x ?? 0) + dx), 0, round((t?.z ?? 0) + dz)];
  }

  addModel(entry: ModelEntry, kind: 'prop' | 'npc', where: { parentId?: string; bone?: string } = {}): string {
    const s = entry.scale ?? 1;
    return this.store.add({
      kind,
      name: entry.name,
      glb: entry.glb,
      parentId: where.parentId,
      attachBone: where.bone,
      position: where.parentId ? [0, 0, 0] : this.spawnPoint(),
      scale: [s, s, s]
    });
  }

  addMap(entry: { id: string; name: string }, parentId?: string): string {
    return this.store.add({ kind: 'map', name: entry.name, mapId: entry.id, parentId });
  }

  addGroup(parentId?: string): string {
    return this.store.add({ kind: 'group', name: 'Group', parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() });
  }

  async outfitItems(snapshot: OutfitSnapshot): Promise<NewItem[]> {
    const records = await Promise.all(snapshot.items.map((e) => getItem(e.id)));
    const out: NewItem[] = [];
    records.forEach((record, i) => {
      if (record) out.push({ itemId: record.id, name: record.name, slots: record.slots, color: snapshot.items[i].color });
    });
    return out;
  }

  async addCharacter(name: string, snapshot: OutfitSnapshot, parentId?: string): Promise<string> {
    const items = await this.outfitItems(snapshot);
    return this.store.addCharacter(
      { name, gender: snapshot.gender, skin: snapshot.skin, parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() },
      items
    );
  }

  addBaseCharacter(gender: 0 | 1, parentId?: string): string {
    return this.store.addCharacter(
      { name: gender === 1 ? 'Female' : 'Male', gender, skin: DEFAULT_SKIN, parentId, position: parentId ? [0, 0, 0] : this.spawnPoint() },
      []
    );
  }

  /** Make a character wear a saved outfit (one undo step per change; gender and skin follow the outfit). */
  async applyOutfit(characterId: string, snapshot: OutfitSnapshot) {
    const character = this.store.node(characterId);
    if (!character || character.kind !== 'character') return;
    const items = await this.outfitItems(snapshot);
    if (character.gender !== snapshot.gender || character.skin !== snapshot.skin) {
      this.store.update(characterId, { gender: snapshot.gender, skin: snapshot.skin });
    }
    this.store.setOutfit(characterId, items);
  }

  /** Wear an item: it becomes a child of the character (optionally mounted on a bone). */
  commitItem(target: AddTarget, item: ItemRecord, color?: number): string {
    return this.store.equipItem(target.nodeId, {
      itemId: item.id,
      name: item.name,
      slots: item.slots,
      color,
      attachBone: target.bone
    });
  }

  saveOutfit(characterId: string, name: string): boolean {
    const snapshot = nodesToOutfit(this.store.nodes, characterId);
    const trimmed = name.trim();
    if (!snapshot || !trimmed) return false;
    saveNamed(localStorage, trimmed, snapshot);
    return true;
  }

  /** Turn the props of a map around the camera target into individual nodes, grouped under a new group. */
  async extractMapProps(mapNodeId: string, radius: number) {
    const map = this.store.node(mapNodeId);
    const toWorld = this.runtime.worldMatrixOf(mapNodeId);
    if (!map || map.kind !== 'map' || !map.mapId || !toWorld) return;
    this.busy = 'extract';
    this.message = '';
    try {
      const res = await fetch(`/api/maps/${map.mapId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as MapData;
      const target = this.view.target?.() ?? new Vector3();
      const center = target.clone().applyMatrix4(toWorld.clone().invert());
      const props = extractNearby(data, center, radius, EXTRACT_LIMIT);
      if (props.length === 0) {
        this.message = 'No props within that radius of the camera target.';
        return;
      }
      const specs = [
        { kind: 'group' as const, name: `${map.name} props` },
        ...props.map((p) => {
          const parts = decomposeForScene(toWorld.clone().multiply(p.matrix));
          const name = p.glb.split('/').pop()!.replace(/\.glb$/i, '');
          return { kind: 'prop' as const, name, glb: p.glb, parentIndex: 0, ...parts };
        })
      ];
      const ids = this.store.addMany(specs);
      if (ids[0]) this.store.select(ids[0]);
      this.message = `Added ${props.length} props${props.length === EXTRACT_LIMIT ? ` (limited to the nearest ${EXTRACT_LIMIT})` : ''}.`;
    } catch (e) {
      this.message = `Could not extract props: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.busy = '';
    }
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
    const blob = new Blob([JSON.stringify(this.store.toData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importJson(file: File) {
    this.message = this.store.loadJson(await file.text()) ? '' : 'That file is not a valid scene.';
  }

  // ----- view helpers --------------------------------------------------------------------------------------------

  focus(id: string | null) {
    const target = id ? this.runtime.focusTarget(id) : undefined;
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

  // ----- Add Child and menus --------------------------------------------------------------------------------------

  openAddChild(nodeId: string, bone?: string) {
    this.menu = null;
    this.addTarget = { nodeId, bone };
  }

  closeAddChild() {
    this.runtime.clearItemPreview();
    this.runtime.clearGhost();
    this.addTarget = null;
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
        { label: 'Add Child...', action: () => this.openAddChild(target.characterId, target.bone) },
        { label: 'Select', action: () => store.selectBone(target.characterId, target.bone) }
      ];
    }
    if (target.type === 'empty') {
      return [
        { label: 'Add Group', action: () => this.addGroup() },
        { label: 'Add Female character', action: () => this.addBaseCharacter(1) },
        { label: 'Add Male character', action: () => this.addBaseCharacter(0) }
      ];
    }
    const node = store.node(target.id);
    if (!node) return [];
    const id = node.id;
    const item = node.kind === 'item';
    return [
      { label: 'Add Child...', action: () => this.openAddChild(id), disabled: item },
      { label: 'Rename', action: () => (this.renaming = id) },
      { label: 'Focus', action: () => this.focus(id) },
      { label: 'Duplicate', action: () => store.duplicate(id), disabled: item, separator: true },
      { label: 'Group', action: () => store.group(id), disabled: item },
      { label: 'Unparent', action: () => store.reparent(id, null), disabled: item || node.parentId === null },
      { label: node.visible ? 'Hide' : 'Show', action: () => this.toggleVisible(id), separator: true },
      { label: node.locked ? 'Unlock' : 'Lock', action: () => this.toggleLocked(id) },
      { label: 'Export GLB', action: () => void this.exportGlb(id), disabled: item || node.kind === 'map' },
      { label: 'Delete', action: () => store.remove(id), danger: true, separator: true }
    ];
  }

  dispose() {
    this.runtime.dispose();
  }
}
