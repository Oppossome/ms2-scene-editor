import {
  Box3,
  Box3Helper,
  Color,
  Euler,
  Group,
  Material,
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
import type { AnimationPlayer } from '../assets/animation.js';
import { instantiate } from '../assets/loader.js';
import type { CharacterRig, BoneInfo } from '../entities/character/rig.js';
import { exportGlb } from '../export/glb.js';
import { EntityBatches, InstanceTarget } from '../maps/entity-batches.js';
import type { ClipInfo, MapEnvironment } from '../types.js';
import { FRAME_RATE } from '../assets/frames.js';
import type { LocalTransform } from './store.svelte.js';
import { descendantsOf, flatten, rootOf } from './tree.js';
import { CharacterEntity } from '../entities/character/character.svelte.js';
import { GroupEntity } from '../entities/group.svelte.js';
import { ItemEntity } from '../entities/character/item.svelte.js';
import { LightingEntity } from '../entities/lighting.svelte.js';
import { PropEntity } from '../entities/prop.svelte.js';
import { RiggedModel } from '../entities/rigged-model.svelte.js';
import type { Entity } from '../entities/types.js';
import type { RenderContext } from '../entities/render-context.js';

/** World-space box around the visible meshes under `roots`; shared-batch props contribute their own bounds. */
function visibleBounds(roots: Object3D[]): Box3 {
  const bounds = new Box3();
  const part = new Box3();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible((object) => {
      if (object instanceof InstanceTarget) {
        bounds.union(part.copy(object.boundingBox).applyMatrix4(object.matrixWorld));
      } else if (object instanceof Mesh) {
        object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox)
          bounds.union(part.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
      }
    });
  }
  return bounds;
}

interface RuntimeHooks {
  defaultClip?: (id: string, clip: string) => void;
  error?: (message: string) => void;
}

/**
 * The scene's three.js side: it renders the entities (each owns its objects), and answers scene-wide questions
 * the UI has: picking, bounds, bones, clips, world-preserving reparenting and export.
 */
export class SceneRuntime {
  readonly root = new Group();
  /** Selection outline and bone marker; kept out of `root` so it is never picked or exported. */
  readonly overlay = new Group();
  hooks: RuntimeHooks = {};
  /** Bumped when the object graph changes (models, rigs, bones) so the UI can re-read it. */
  version = $state(0);
  clipInfos = $state.raw<Record<string, ClipInfo[]>>({});

  private rendered = new Map<string, Entity>();
  private tags = new WeakMap<Object3D, string>();
  private nodes: Entity[] = [];
  private byId = new Map<string, Entity>();
  private children = new Map<string | null, Entity[]>();
  private raycaster = new Raycaster();
  private box = new Box3Helper(new Box3(), new Color(0xffd84d));
  private boneMarker = new Mesh(
    new SphereGeometry(2, 12, 8),
    new MeshBasicMaterial({ color: 0xffd84d, depthTest: false, transparent: true })
  );
  private selection: { id: string | null; bone: { characterId: string; bone: string } | null } = {
    id: null,
    bone: null
  };
  private frame = 0;
  private batched = new Set<PropEntity>();
  /** Models that cannot share a batch (skinned or animated): their props render as ordinary models. */
  private unbatchable = new Set<string>();
  private batches = new EntityBatches(
    this.root,
    () => this.bump(),
    (message, error) => this.report(message, error),
    (path) => this.useRegularModels(path)
  );

  private context: RenderContext = {
    tag: (object, id) => this.tags.set(object, id),
    changed: () => this.bump(),
    reparent: () => this.reparentAll(),
    clips: (id, clips) => {
      if (clips.length) this.clipInfos = { ...this.clipInfos, [id]: clips };
      else if (this.clipInfos[id]) {
        const next = { ...this.clipInfos };
        delete next[id];
        this.clipInfos = next;
      }
    },
    defaultClip: (id, clip) => this.hooks.defaultClip?.(id, clip),
    items: (id) => (this.children.get(id) ?? []).filter((entity): entity is ItemEntity => entity instanceof ItemEntity),
    entity: (id) => this.byId.get(id),
    batch: (prop) => {
      if (this.unbatchable.has(prop.glb)) return false;
      this.batched.add(prop);
      return true;
    },
    unbatch: (prop) => {
      this.batched.delete(prop);
      if (prop.object instanceof InstanceTarget) prop.object.boundingBox.makeEmpty();
    },
    error: (message, error) => this.report(message, error)
  };

  constructor() {
    this.box.visible = false;
    this.box.renderOrder = 998;
    (this.box.material as Material).depthTest = false;
    this.boneMarker.visible = false;
    this.boneMarker.renderOrder = 999;
    this.overlay.add(this.box, this.boneMarker);
  }

  private report(message: string, error: unknown) {
    console.error(message, error);
    this.hooks.error?.(`${message}: ${error instanceof Error ? error.message : error}`);
  }

  private bump() {
    untrack(() => this.version++);
  }

  private useRegularModels(path: string) {
    this.unbatchable.add(path);
    for (const prop of [...this.batched]) {
      if (prop.glb !== path) continue;
      this.context.unbatch(prop);
      prop.render(this.context);
    }
    this.batches.sync([...this.batched]);
    this.reparentAll();
    this.bump();
  }

  // ----- registry -------------------------------------------------------------------------------------------

  /** The object a node's gizmo should drive; undefined for skinned items, Lighting and nodes not loaded yet. */
  objectOf(id: string | null | undefined): Object3D | undefined {
    return id ? this.byId.get(id)?.gizmoTarget : undefined;
  }

  /** World-space bounds of an entity's visible geometry, to frame the camera on. */
  boundsOf(id: string): Box3 | null {
    const entity = this.byId.get(id);
    if (!entity || !this.visibleEntity(entity)) return null;
    const box = visibleBounds(entity.boundsTargets());
    return box.isEmpty() ? null : box;
  }

  playerOf(id: string): AnimationPlayer | null {
    const entity = this.byId.get(id);
    return entity instanceof RiggedModel ? entity.player : null;
  }

  clipsOf(id: string): ClipInfo[] {
    return this.clipInfos[id] ?? [];
  }

  rigOf(id: string): CharacterRig | null {
    const entity = this.byId.get(id);
    return entity instanceof CharacterEntity ? entity.rig : null;
  }

  /** The backdrop and fog of the scene: those of its first effectively visible Lighting entity (empty when it sets none). */
  mapEnvironment(): MapEnvironment | null {
    void this.version;
    for (const { node } of flatten(this.nodes)) {
      if (node instanceof LightingEntity && this.visibleEntity(node)) return node.environment;
    }
    return null;
  }

  private visibleEntity(entity: Entity): boolean {
    for (
      let current: Entity | undefined = entity;
      current;
      current = current.parentId ? this.byId.get(current.parentId) : undefined
    ) {
      if (!current.visible) return false;
    }
    return true;
  }

  isSkinned(itemId: string): boolean {
    void this.version;
    const item = this.byId.get(itemId);
    const rig = item?.parentId ? this.rigOf(item.parentId) : null;
    return item instanceof ItemEntity && !!rig && rig.isEquipped(item.itemId) && rig.mountsOf(item.itemId).length === 0;
  }

  defaultBoneOf(itemId: string): string {
    void this.version;
    const item = this.byId.get(itemId);
    return item instanceof ItemEntity && item.parentId
      ? (this.rigOf(item.parentId)?.defaultBoneOf(item.itemId) ?? '')
      : '';
  }

  boneTree(characterId: string): BoneInfo[] {
    void this.version;
    return this.rigOf(characterId)?.boneTree() ?? [];
  }

  boneNames(characterId: string): string[] {
    const names: string[] = [];
    const walk = (bones: BoneInfo[]) => {
      for (const bone of bones) {
        names.push(bone.name);
        walk(bone.children);
      }
    };
    walk(this.boneTree(characterId));
    return names;
  }

  // ----- rendering -----------------------------------------------------------------------------------------

  /** Render what is new or changed; entities that stay as they are keep their objects. */
  sync(nodes: Entity[], changedIds?: ReadonlySet<string>) {
    untrack(() => {
      this.nodes = nodes;
      this.byId = new Map(nodes.map((entity) => [entity.id, entity]));
      this.children.clear();
      for (const entity of nodes) {
        const siblings = this.children.get(entity.parentId) ?? [];
        siblings.push(entity);
        this.children.set(entity.parentId, siblings);
      }
      for (const [id, entity] of this.rendered) {
        if (this.byId.get(id) === entity) continue;
        entity.dispose();
        this.rendered.delete(id);
      }
      for (const entity of nodes) {
        const fresh = !this.rendered.has(entity.id);
        if (fresh) this.rendered.set(entity.id, entity);
        if (fresh || entity.renderedRevision !== entity.revision || changedIds?.has(entity.id))
          entity.render(this.context);
      }
      this.reparentAll();
      this.batches.sync([...this.batched], this.boneMountedProps());
      this.bump();
      this.updateOverlay();
    });
  }

  /** Props inside a bone-mounted subtree move with an animation, so their batch matrices follow it. */
  private boneMountedProps(): Set<string> {
    const moving = new Set<string>();
    for (const prop of this.batched) {
      for (let current: Entity | undefined = prop; current?.parentId; current = this.byId.get(current.parentId)) {
        if (current.attachBone && this.byId.get(current.parentId)?.type === 'character') {
          moving.add(prop.id);
          break;
        }
      }
    }
    return moving;
  }

  /** Put every object under the object it belongs to: its parent's group, or a bone of the parent character. */
  private reparentAll() {
    for (const entity of this.nodes) {
      if (!entity.object) continue;
      let target: Object3D = this.root;
      if (entity.parentId) {
        target = this.byId.get(entity.parentId)?.object ?? this.root;
        if (entity.attachBone) target = this.rigOf(entity.parentId)?.resolve(entity.attachBone) ?? target;
      }
      if (entity.object.parent !== target) target.add(entity.object);
    }
  }

  currentFrame(id: string) {
    return Math.round((this.playerOf(id)?.time ?? 0) * FRAME_RATE);
  }

  /** Call every frame. */
  update(delta: number) {
    for (const entity of this.rendered.values()) entity.tick(delta);
    this.batches.updateAnimated();
    if (++this.frame % 6 === 0) this.updateOverlay();
  }

  setSelection(id: string | null, bone: { characterId: string; bone: string } | null) {
    this.selection = { id, bone };
    this.updateOverlay();
  }

  private updateOverlay() {
    const { id, bone } = this.selection;
    this.box.visible = this.boneMarker.visible = false;
    if (bone) {
      const object = this.rigOf(bone.characterId)?.resolve(bone.bone);
      if (object) {
        object.getWorldPosition(this.boneMarker.position);
        this.boneMarker.visible = true;
      }
      return;
    }
    const entity = id ? this.byId.get(id) : undefined;
    if (!entity || !this.visibleEntity(entity)) return;
    const bounds = visibleBounds(entity.boundsTargets());
    if (!bounds.isEmpty()) {
      this.box.box.copy(bounds);
      this.box.visible = true;
    }
  }

  /** Group position and direct-child positions that center its origin without changing child world positions. */
  groupCenterPositions(id: string): { id: string; position: [number, number, number] }[] | null {
    void this.version;
    const group = this.byId.get(id);
    if (!(group instanceof GroupEntity) || !group.object) return null;
    const children = (this.children.get(id) ?? []).filter((child) => child.type !== 'item');
    const bounds = visibleBounds(children.flatMap((child) => child.boundsTargets()));
    if (bounds.isEmpty()) return null;
    const object = group.object;
    const parent = object.parent ?? this.root;
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) return null;
    const center = bounds.getCenter(new Vector3()).applyMatrix4(parent.matrixWorld.clone().invert());
    const delta = center.clone().sub(object.position);
    const scale = object.scale;
    if (Math.abs(scale.x) < 1e-12 || Math.abs(scale.y) < 1e-12 || Math.abs(scale.z) < 1e-12) return null;
    const offset = delta.applyQuaternion(object.quaternion.clone().invert()).divide(scale).negate();
    return [
      { id, position: [center.x, center.y, center.z] },
      ...children.flatMap((child) => {
        if (!child.object) return [];
        const position = child.object.position.clone().add(offset);
        return [{ id: child.id, position: [position.x, position.y, position.z] as [number, number, number] }];
      })
    ];
  }

  // ----- picking ---------------------------------------------------------------------------------------------

  /** The node under a point (normalised device coordinates). `top` returns the root ancestor instead. */
  pick(ndc: Vector2, camera: Camera, top = false): string | null {
    this.raycaster.setFromCamera(ndc, camera);
    for (const hit of this.raycaster.intersectObject(this.root, true)) {
      if (!this.visibleChain(hit.object)) continue;
      let id = this.batches.pick(hit);
      let object: Object3D | null = hit.object;
      while (!id && object) {
        id = this.tags.get(object);
        object = object.parent;
      }
      const entity = id ? this.byId.get(id) : undefined;
      if (!id || !entity || entity.locked || !this.visibleEntity(entity)) continue;
      return top ? (rootOf(this.nodes, id)?.id ?? id) : id;
    }
    return null;
  }

  private visibleChain(object: Object3D | null) {
    for (let current = object; current; current = current.parent) if (!current.visible) return false;
    return true;
  }

  // ----- reparenting ----------------------------------------------------------------------------------------

  /** Local transform that keeps a node's world pose under a new parent (and bone). */
  localFor(id: string, parentId: string | null, bone?: string): LocalTransform | null {
    const entity = this.byId.get(id);
    if (!entity?.object || entity.type === 'item') return null;
    entity.object.updateWorldMatrix(true, false);
    let parent: Object3D = (parentId ? this.byId.get(parentId)?.object : null) ?? this.root;
    if (bone && parentId) parent = this.rigOf(parentId)?.resolve(bone) ?? parent;
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) return null;
    const local = parent.matrixWorld.clone().invert().multiply(entity.object.matrixWorld);
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

  // ----- export -----------------------------------------------------------------------------------------------

  /**
   * Export an entity (with everything below it) or the whole scene as GLB. Groups made from maps are left out. A
   * playing animation is included only when the exported part holds a single animated model (track names address
   * nodes by name).
   */
  async exportGlb(rootId: string | null, withClip: boolean): Promise<ArrayBuffer | null> {
    const roots = rootId
      ? [rootId]
      : this.nodes.filter((entity) => entity.parentId === null).map((entity) => entity.id);
    const members = new Set<string>();
    for (const id of roots) {
      members.add(id);
      for (const child of descendantsOf(this.nodes, id)) members.add(child.id);
    }
    const isMap = (entity: Entity) => entity instanceof GroupEntity && !!entity.mapId;
    const objects: Object3D[] = roots
      .map((id) => this.byId.get(id))
      .filter((entity): entity is Entity => !!entity?.object && entity.visible && !isMap(entity))
      .map((entity) => entity.object!);
    for (const id of members) {
      const entity = this.byId.get(id);
      if (entity instanceof CharacterEntity && entity.rig) {
        entity.rig.updateFace(entity.player?.clip?.name ?? '', entity.player?.time ?? 0, entity.expression);
        await entity.rig.faceReady();
      }
    }

    const restore: (() => void)[] = [];
    try {
      // Batched props have no geometry of their own: give the ones being exported their model for the duration.
      for (const id of members) {
        const entity = this.byId.get(id);
        if (!(entity instanceof PropEntity) || !entity.batched || !entity.visible) continue;
        let omitted = false;
        for (
          let parent = this.byId.get(entity.parentId ?? '');
          parent && members.has(parent.id);
          parent = this.byId.get(parent.parentId ?? '')
        ) {
          if (isMap(parent)) omitted = true;
        }
        if (omitted) continue;
        const loaded = await instantiate(entity.glb);
        entity.object!.add(loaded.object);
        restore.push(() => loaded.object.removeFromParent());
      }
      if (!objects.length) return null;
      for (const entity of this.rendered.values()) {
        if (!entity.object) continue;
        const object = entity.object;
        const name = object.name;
        object.name = entity.name;
        restore.push(() => (object.name = name));
        if (members.has(entity.id) && isMap(entity)) {
          const visible = object.visible;
          object.visible = false;
          restore.push(() => (object.visible = visible));
        }
      }
      const players: RiggedModel[] = [];
      for (const id of members) {
        const entity = this.byId.get(id);
        if (entity instanceof RiggedModel && entity.player) players.push(entity);
      }
      const clip = withClip && rootId && players.length === 1 ? players[0].player?.clip : null;
      return await exportGlb(objects, { animations: clip ? [clip] : [] });
    } finally {
      for (const undo of restore) undo();
    }
  }

  // ----- lifecycle --------------------------------------------------------------------------------------------

  dispose() {
    this.batches.dispose();
    for (const entity of this.rendered.values()) entity.dispose();
    this.rendered.clear();
    this.root.removeFromParent();
    this.overlay.removeFromParent();
    this.box.geometry.dispose();
    this.boneMarker.geometry.dispose();
    (this.boneMarker.material as Material).dispose();
  }
}
