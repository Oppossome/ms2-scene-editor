import {
  AnimationClip,
  Box3,
  Box3Helper,
  Color,
  Euler,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Camera
} from 'three';
import { untrack } from 'svelte';
import { AnimationPlayer } from '../assets/animation.js';
import { instantiate, loadClips } from '../assets/loader.js';
import { embeddedClips, fetchBodyClips, idleClip } from '../assets/clips.js';
import { bodyClipDir } from '../assets/urls.js';
import { eyeTint, getItem, itemTint, skinTint } from '../character/build.js';
import { CharacterRig, type BoneInfo } from '../character/rig.js';
import { exportGlb } from '../export/glb.js';
import { buildMap, type BuiltMap } from '../maps/instancing.js';
import type { ClipInfo, MapData, MapEnvironment } from '../types.js';
import { DEFAULT_EYE, DEFAULT_SKIN, FRAME_RATE, type SceneNode } from './model.js';
import type { LocalTransform } from './store.svelte.js';

/**
 * World-space box around the visible meshes under `roots`. Hidden subtrees (body parts replaced by
 * clothes, unused skeleton bones) are skipped, so they don't stretch the selection outline.
 */
function visibleBounds(roots: Object3D[]): Box3 {
  const bounds = new Box3();
  const part = new Box3();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible((o) => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry;
      geometry.computeBoundingBox();
      if (!geometry.boundingBox) return;
      part.copy(geometry.boundingBox).applyMatrix4(o.matrixWorld);
      bounds.union(part);
    });
  }
  return bounds;
}
import { descendantsOf, rootOf } from './tree.js';

interface ItemLink {
  /** Bone the item is currently mounted on ('' = its default). */
  bone: string;
}

interface View {
  id: string;
  node: SceneNode;
  /** The object the node's transform applies to. For items it becomes the first mount of the equipped item. */
  group: Group;
  placeholder: Group;
  key: string;
  gen: number;
  disposed: boolean;
  player: AnimationPlayer | null;
  embedded: AnimationClip[];
  rig: CharacterRig | null;
  map: BuiltMap | null;
  /** Backdrop and fog of a loaded map. */
  environment: MapEnvironment | null;
  content: Object3D | null;
  /** Characters: item reconciliation state. */
  itemSig: string;
  itemColors: Map<string, string>;
  reconciling: boolean;
  dirty: boolean;
  skinApplied: number | undefined;
  eyeApplied: number | undefined;
  clipRequested: string | undefined;
  link: ItemLink;
}

export interface RuntimeHooks {
  /** A freshly loaded NPC/character has no clip yet: let the owner give it its idle animation. */
  defaultClip?: (id: string, clip: string) => void;
}

const contentKey = (n: SceneNode) => JSON.stringify([n.kind, n.glb, n.mapId, n.gender]);
const itemSignature = (items: SceneNode[]) =>
  items.map((i) => `${i.id}:${i.itemId}:${i.color ?? ''}:${i.channelColors ? JSON.stringify(i.channelColors) : ''}`).join('|');

/**
 * The three.js side of the scene. It mirrors the node tree into a real object graph (groups, loaded models,
 * character rigs with their worn items, map instances), and answers questions the UI has about it: picking,
 * bones, clips, world-preserving reparenting, previews and export.
 */
export class SceneRuntime {
  readonly root = new Group();
  /** Selection outline and bone marker; kept out of `root` so it is never picked or exported. */
  readonly overlay = new Group();
  hooks: RuntimeHooks = {};

  /** Bumped when the object graph changes (models, rigs, bones) so the UI can re-read it. */
  version = $state(0);
  clipInfos = $state.raw<Record<string, ClipInfo[]>>({});

  private views = new Map<string, View>();
  private tags = new WeakMap<Object3D, string>();
  private nodes: SceneNode[] = [];
  private byId = new Map<string, SceneNode>();
  private raycaster = new Raycaster();
  private box = new Box3Helper(new Box3(), new Color(0xffd84d));
  private boneMarker = new Mesh(
    new SphereGeometry(2, 12, 8),
    new MeshBasicMaterial({ color: 0xffd84d, depthTest: false, transparent: true })
  );
  private selection: { id: string | null; bone: { characterId: string; bone: string } | null } = { id: null, bone: null };
  private frame = 0;

  constructor() {
    this.box.visible = false;
    this.box.renderOrder = 998;
    (this.box.material as Material).depthTest = false;
    this.boneMarker.visible = false;
    this.boneMarker.renderOrder = 999;
    this.overlay.add(this.box, this.boneMarker);
  }

  // ----- registry -------------------------------------------------------------------------------------------

  /** The object a node's gizmo should drive; undefined for skinned items and nodes not loaded yet. */
  objectOf(id: string | null | undefined): Object3D | undefined {
    const view = id ? this.views.get(id) : undefined;
    if (!view) return undefined;
    if (view.node.kind === 'item' && view.group === view.placeholder) return undefined;
    return view.group;
  }

  /** Something to frame the camera on for a node. */
  focusTarget(id: string): Object3D | undefined {
    const view = this.views.get(id);
    if (!view) return undefined;
    if (view.node.kind === 'item') {
      const parent = view.node.parentId ? this.views.get(view.node.parentId) : undefined;
      return parent?.rig?.objectsOf(view.node.itemId ?? '')[0] ?? view.group;
    }
    return view.group;
  }

  playerOf(id: string): AnimationPlayer | null {
    return this.views.get(id)?.player ?? null;
  }

  clipsOf(id: string): ClipInfo[] {
    return this.clipInfos[id] ?? [];
  }

  rigOf(characterId: string): CharacterRig | null {
    return this.views.get(characterId)?.rig ?? null;
  }

  /** The backdrop and fog of the scene: those of its first visible map that sets any. */
  mapEnvironment(): MapEnvironment | null {
    void this.version;
    for (const node of this.nodes) {
      if (node.kind !== 'map' || !node.visible) continue;
      const env = this.views.get(node.id)?.environment;
      if (env) return env;
    }
    return null;
  }

  isSkinned(itemNodeId: string): boolean {
    void this.version;
    const node = this.byId.get(itemNodeId);
    const rig = node?.parentId ? this.rigOf(node.parentId) : null;
    if (!node || !rig || !node.itemId || !rig.isEquipped(node.itemId)) return false;
    return rig.mountsOf(node.itemId).length === 0;
  }

  defaultBoneOf(itemNodeId: string): string {
    void this.version;
    const node = this.byId.get(itemNodeId);
    const rig = node?.parentId ? this.rigOf(node.parentId) : null;
    return rig && node?.itemId ? rig.defaultBoneOf(node.itemId) : '';
  }

  boneTree(characterId: string): BoneInfo[] {
    void this.version;
    return this.rigOf(characterId)?.boneTree() ?? [];
  }

  boneNames(characterId: string): string[] {
    const out: string[] = [];
    const walk = (list: BoneInfo[]) => {
      for (const b of list) {
        out.push(b.name);
        walk(b.children);
      }
    };
    walk(this.boneTree(characterId));
    return out;
  }

  private bump() {
    untrack(() => this.version++);
  }

  private tag(object: Object3D, id: string) {
    this.tags.set(object, id);
  }

  // ----- syncing the node tree ------------------------------------------------------------------------------

  /** Make the object graph match the nodes. Cheap when little changed: untouched nodes are skipped by identity. */
  sync(nodes: SceneNode[]) {
    untrack(() => {
      this.nodes = nodes;
      this.byId = new Map(nodes.map((n) => [n.id, n]));
      for (const [id, view] of this.views) {
        if (!this.byId.has(id)) {
          this.disposeView(view);
          this.views.delete(id);
        }
      }
      for (const node of nodes) {
        let view = this.views.get(node.id);
        const prev = view?.node;
        if (!view) {
          view = this.createView(node);
          this.views.set(node.id, view);
        }
        if (!prev || prev !== node) {
          view.node = node;
          this.apply(view, prev);
        }
      }
      this.reparentAll();
      for (const view of this.views.values()) if (view.node.kind === 'character') this.syncCharacterItems(view);
    });
  }

  private createView(node: SceneNode): View {
    const group = new Group();
    this.tag(group, node.id);
    return {
      id: node.id,
      node,
      group,
      placeholder: group,
      key: '',
      gen: 0,
      disposed: false,
      player: null,
      embedded: [],
      rig: null,
      map: null,
      environment: null,
      content: null,
      itemSig: '',
      itemColors: new Map(),
      reconciling: false,
      dirty: false,
      skinApplied: undefined,
      eyeApplied: undefined,
      clipRequested: undefined,
      link: { bone: '' }
    };
  }

  private apply(view: View, prev: SceneNode | undefined) {
    const node = view.node;
    if (node.kind === 'item') return; // items are driven by their character
    const key = contentKey(node);
    if (!prev || key !== view.key) {
      view.key = key;
      void this.loadContent(view);
    }
    this.applyTransform(view.group, node);
    view.group.visible = node.visible;
    if (view.rig && (node.skin !== view.skinApplied || node.eye !== view.eyeApplied)) void this.applySkin(view);
    if (view.player) view.player.mixer.timeScale = node.speed ?? 1;
    if (!prev || prev.clip !== node.clip) void this.playClip(view);
    else if (prev.freeze !== node.freeze) this.applyFreeze(view);
  }

  private applyTransform(object: Object3D, node: SceneNode) {
    object.position.set(...node.position);
    object.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2], 'XYZ');
    object.scale.set(...node.scale);
  }

  /** Put every node under the object it belongs to: its parent's group, or a bone of the parent character. */
  private reparentAll() {
    for (const node of this.nodes) {
      if (node.kind === 'item') continue;
      const view = this.views.get(node.id);
      if (!view) continue;
      let target: Object3D = this.root;
      const parent = node.parentId ? this.byId.get(node.parentId) : undefined;
      if (parent) {
        const pv = this.views.get(parent.id);
        target = pv?.group ?? this.root;
        if (parent.kind === 'character' && node.attachBone) target = pv?.rig?.resolve(node.attachBone) ?? target;
      }
      if (view.group.parent !== target) target.add(view.group);
    }
  }

  private disposeView(view: View) {
    view.disposed = true;
    view.gen++;
    this.disposeContent(view);
    view.group.removeFromParent();
    if (view.node.kind === 'item') {
      // The rig removes the item's objects once the character reconciles.
      view.group = view.placeholder;
    }
    this.bump();
  }

  private disposeContent(view: View) {
    view.player?.dispose();
    view.player = null;
    view.rig?.dispose();
    view.rig = null;
    view.map?.dispose();
    view.map = null;
    view.environment = null;
    view.content?.removeFromParent();
    view.content = null;
    view.embedded = [];
    view.skinApplied = undefined;
    view.eyeApplied = undefined;
    view.clipRequested = undefined;
    view.itemSig = '';
    view.itemColors.clear();
    for (const n of this.nodes) {
      if (n.parentId !== view.id || n.kind !== 'item') continue;
      const itemView = this.views.get(n.id);
      if (itemView) {
        itemView.group = itemView.placeholder;
        itemView.link.bone = '';
      }
    }
    if (this.clipInfos[view.id]) {
      const next = { ...this.clipInfos };
      delete next[view.id];
      this.clipInfos = next;
    }
  }

  // ----- content --------------------------------------------------------------------------------------------

  private async loadContent(view: View) {
    const gen = ++view.gen;
    this.disposeContent(view);
    const node = view.node;
    try {
      let clips: ClipInfo[] = [];
      if (node.kind === 'character') {
        const rig = await CharacterRig.create(
          node.gender ?? 1,
          await skinTint(node.skin ?? DEFAULT_SKIN),
          await eyeTint(node.eye ?? DEFAULT_EYE)
        );
        if (gen !== view.gen) return rig.dispose();
        view.rig = rig;
        view.skinApplied = node.skin;
        view.eyeApplied = node.eye;
        view.content = rig.root;
        view.group.add(rig.root);
        view.player = new AnimationPlayer(rig.root);
        this.tag(rig.root, view.id);
        const bodyClips = await fetchBodyClips(rig.gender).catch(() => []);
        if (gen === view.gen) clips = bodyClips;
      } else if (node.kind === 'map' && node.mapId) {
        const res = await fetch(`/api/maps/${node.mapId}`);
        if (!res.ok) throw new Error(`map ${node.mapId}: ${res.status}`);
        const data = (await res.json()) as MapData;
        if (gen !== view.gen) return;
        view.environment = data.environment ?? null;
        view.map = buildMap(data, { cancelled: () => gen !== view.gen });
        view.content = view.map.group;
        view.group.add(view.map.group);
      } else if (node.glb) {
        const loaded = await instantiate(node.glb);
        if (gen !== view.gen) return;
        view.embedded = loaded.animations;
        view.player = new AnimationPlayer(loaded.object);
        view.content = loaded.object;
        view.group.add(loaded.object);
        clips = embeddedClips(loaded.animations);
      }
      if (gen !== view.gen) return;
      if (view.player) view.player.mixer.timeScale = view.node.speed ?? 1;
      if (clips.length) this.clipInfos = { ...this.clipInfos, [view.id]: clips };
      this.reparentAll();
      if (view.rig) this.syncCharacterItems(view);
      this.bump();
      if (!view.node.clip) {
        const idle = idleClip(clips);
        if (idle) this.hooks.defaultClip?.(view.id, idle);
      }
      await this.playClip(view);
    } catch (e) {
      console.error(`Failed to load ${node.name}`, e);
    }
  }

  private async applySkin(view: View) {
    const rig = view.rig;
    const { skin, eye } = view.node;
    if (!rig) return;
    view.skinApplied = skin;
    view.eyeApplied = eye;
    const [skinColors, eyeColors] = await Promise.all([skinTint(skin ?? DEFAULT_SKIN), eyeTint(eye ?? DEFAULT_EYE)]);
    if (view.rig !== rig) return;
    if (skinColors) rig.setSkinColors(skinColors);
    if (eyeColors) rig.setEyeColors(eyeColors);
  }

  private async playClip(view: View) {
    const player = view.player;
    const name = view.node.clip;
    if (!player) return;
    view.clipRequested = name;
    if (!name) return player.stop();
    if (view.rig) {
      const clips = await loadClips(`${bodyClipDir(view.rig.gender)}/${name}.glb`).catch(() => []);
      if (view.player === player && view.clipRequested === name && clips[0]) player.play(clips[0], true);
    } else {
      const clip = view.embedded.find((c) => c.name === name);
      if (clip) player.play(clip, true);
    }
    if (view.player === player) this.applyFreeze(view);
  }

  /** Hold the clip on the node's freeze frame, or let it play again. */
  private applyFreeze(view: View) {
    const player = view.player;
    if (!player?.clip) return;
    const frame = view.node.freeze;
    if (frame === undefined) player.unfreeze();
    else player.freeze(frame / FRAME_RATE);
  }

  /** The frame a node's animation is on now (0 when nothing plays), to freeze it there. */
  currentFrame(id: string): number {
    return Math.round((this.views.get(id)?.player?.time ?? 0) * FRAME_RATE);
  }

  // ----- characters and their items -------------------------------------------------------------------------

  private itemNodes(characterId: string): SceneNode[] {
    return this.nodes.filter((n) => n.parentId === characterId && n.kind === 'item' && n.itemId);
  }

  /** Apply what is cheap and synchronous (offsets, visibility, bones); reconcile the worn set when it changed. */
  private syncCharacterItems(view: View) {
    const rig = view.rig;
    if (!rig) return;
    const items = this.itemNodes(view.id);
    this.applyItemNodes(view, items);
    const sig = itemSignature(items);
    if (sig !== view.itemSig) {
      view.itemSig = sig;
      this.requestReconcile(view);
    }
  }

  private applyItemNodes(view: View, items: SceneNode[]) {
    const rig = view.rig;
    if (!rig) return;
    for (const node of items) {
      const itemView = this.views.get(node.id);
      if (!itemView || !node.itemId || !rig.isEquipped(node.itemId)) continue;
      const mounts = rig.mountsOf(node.itemId);
      const bone = node.attachBone ?? '';
      if (mounts.length && itemView.link.bone !== bone) {
        rig.mountOn(node.itemId, bone);
        itemView.link.bone = bone;
      }
      for (const mount of mounts) this.applyTransform(mount, node);
      rig.setItemVisible(node.itemId, node.visible);
    }
  }

  private requestReconcile(view: View) {
    if (view.reconciling) {
      view.dirty = true;
      return;
    }
    view.reconciling = true;
    void (async () => {
      try {
        do {
          view.dirty = false;
          await this.reconcileItems(view);
        } while (view.dirty && !view.disposed);
      } finally {
        view.reconciling = false;
      }
    })();
  }

  /** Make the rig wear exactly the item children of the character node. */
  private async reconcileItems(view: View) {
    const rig = view.rig;
    if (!rig) return;
    const gen = view.gen;
    const desired = this.itemNodes(view.id);
    const want = new Set(desired.map((d) => d.itemId!));
    for (const id of [...rig.equipped.keys()]) if (!want.has(id)) rig.unequip(id);

    for (const node of desired) {
      if (gen !== view.gen || view.disposed) return;
      const id = node.itemId!;
      const colorKey = `${node.color ?? -1}:${node.channelColors ? JSON.stringify(node.channelColors) : ''}`;
      const worn = rig.isEquipped(id);
      if (worn && view.itemColors.get(id) === colorKey) continue;
      const record = await getItem(id);
      if (!record) continue;
      const colors = await itemTint(record, node.color, node.channelColors);
      if (gen !== view.gen || view.disposed) return;
      try {
        if (worn) {
          if (colors) rig.setItemColors(id, colors);
        } else {
          await rig.equip(record, colors);
        }
        view.itemColors.set(id, colorKey);
      } catch (e) {
        console.warn(`Could not wear ${record.name}`, e);
      }
    }
    if (gen !== view.gen || view.disposed) return;
    this.linkItems(view);
  }

  /** Point each item node at the objects the rig made for it, so picking and the gizmo can find them. */
  private linkItems(view: View) {
    const rig = view.rig;
    if (!rig) return;
    const items = this.itemNodes(view.id);
    for (const node of items) {
      const itemView = this.views.get(node.id);
      if (!itemView || !node.itemId) continue;
      itemView.link.bone = '';
      for (const o of rig.objectsOf(node.itemId)) this.tag(o, node.id);
      itemView.group = rig.mountsOf(node.itemId)[0] ?? itemView.placeholder;
    }
    this.applyItemNodes(view, items);
    this.bump();
  }

  // ----- animation, overlay ---------------------------------------------------------------------------------

  /** Call every frame. */
  update(delta: number) {
    for (const view of this.views.values()) view.player?.update(delta);
    this.frame++;
    if (this.frame % 6 === 0) this.updateOverlay();
  }

  setSelection(id: string | null, bone: { characterId: string; bone: string } | null) {
    this.selection = { id, bone };
    this.updateOverlay();
  }

  private updateOverlay() {
    const { id, bone } = this.selection;
    this.box.visible = false;
    this.boneMarker.visible = false;
    if (bone) {
      const object = this.rigOf(bone.characterId)?.resolve(bone.bone);
      if (object) {
        object.getWorldPosition(this.boneMarker.position);
        this.boneMarker.visible = true;
      }
      return;
    }
    const node = id ? this.byId.get(id) : undefined;
    if (!id || !node || !node.visible || node.kind === 'map') return;
    const bounds = visibleBounds(this.boundsTargets(node));
    if (bounds.isEmpty()) return;
    this.box.box.copy(bounds);
    this.box.visible = true;
  }

  private boundsTargets(node: SceneNode): Object3D[] {
    if (node.kind === 'item') {
      const rig = node.parentId ? this.rigOf(node.parentId) : null;
      return rig && node.itemId ? rig.objectsOf(node.itemId).filter((o) => o.visible) : [];
    }
    const view = this.views.get(node.id);
    return view ? [view.group] : [];
  }

  // ----- picking ---------------------------------------------------------------------------------------------

  /** The node under a point (normalised device coordinates). `top` returns the root ancestor instead. */
  pick(ndc: Vector2, camera: Camera, top = false): string | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      if (!this.visibleChain(hit.object)) continue;
      let o: Object3D | null = hit.object;
      let id: string | undefined;
      while (o && !(id = this.tags.get(o))) o = o.parent;
      if (!id) continue;
      const node = this.byId.get(id);
      if (!node || node.locked) continue;
      return top ? (rootOf(this.nodes, id)?.id ?? id) : id;
    }
    return null;
  }

  private visibleChain(o: Object3D | null): boolean {
    for (let cur = o; cur; cur = cur.parent) if (!cur.visible) return false;
    return true;
  }

  // ----- reparenting ----------------------------------------------------------------------------------------

  /** Local transform that keeps a node's world pose under a new parent (and bone). */
  localFor(id: string, parentId: string | null, bone?: string): LocalTransform | null {
    const view = this.views.get(id);
    if (!view || view.node.kind === 'item') return null;
    view.group.updateWorldMatrix(true, false);
    const world = view.group.matrixWorld.clone();
    let parent: Object3D = this.root;
    if (parentId) {
      const pv = this.views.get(parentId);
      parent = pv?.group ?? this.root;
      if (bone && pv?.rig) parent = pv.rig.resolve(bone) ?? parent;
    }
    parent.updateWorldMatrix(true, false);
    const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    local.decompose(position, quaternion, scale);
    const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
    return {
      position: [position.x, position.y, position.z],
      rotation: [euler.x, euler.y, euler.z],
      scale: [scale.x, scale.y, scale.z]
    };
  }

  /** World matrix of a node's object (for turning a map's props into nodes). */
  worldMatrixOf(id: string): Matrix4 | null {
    const view = this.views.get(id);
    if (!view) return null;
    view.group.updateWorldMatrix(true, false);
    return view.group.matrixWorld.clone();
  }

  // ----- export -----------------------------------------------------------------------------------------------

  /**
   * Export a node (with everything below it) or the whole scene as GLB. Maps are left out. A playing animation
   * is included only when the exported part holds a single animated rig (track names address nodes by name).
   */
  async exportGlb(rootId: string | null, withClip: boolean): Promise<ArrayBuffer | null> {
    const roots = rootId ? [rootId] : this.nodes.filter((n) => n.parentId === null).map((n) => n.id);
    const members = new Set<string>();
    for (const id of roots) {
      members.add(id);
      for (const d of descendantsOf(this.nodes, id)) members.add(d.id);
    }
    const objects = roots
      .map((id) => this.views.get(id))
      .filter((v): v is View => !!v && v.node.visible && v.node.kind !== 'map' && v.node.kind !== 'item')
      .map((v) => v.group);
    if (!objects.length) return null;

    const restore: (() => void)[] = [];
    for (const view of this.views.values()) {
      if (view.node.kind === 'item') continue;
      const name = view.group.name;
      view.group.name = view.node.name;
      restore.push(() => (view.group.name = name));
      if (members.has(view.id) && view.node.kind === 'map') {
        const was = view.group.visible;
        view.group.visible = false;
        restore.push(() => (view.group.visible = was));
      }
    }
    try {
      const players = [...members].map((id) => this.views.get(id)).filter((v) => v?.rig || v?.embedded.length);
      const clip = withClip && rootId && players.length === 1 ? players[0]!.player?.clip : null;
      return await exportGlb(objects, { animations: clip ? [clip] : [] });
    } finally {
      for (const r of restore) r();
    }
  }

  // ----- lifecycle --------------------------------------------------------------------------------------------

  dispose() {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
    this.root.removeFromParent();
    this.overlay.removeFromParent();
    this.box.geometry.dispose();
    this.boneMarker.geometry.dispose();
    (this.boneMarker.material as Material).dispose();
  }
}
