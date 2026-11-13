import { Group, Mesh, Object3D, PropertyBinding, Skeleton, SkinnedMesh } from 'three';
import { instantiate } from '../../assets/loader.js';
import { bodyModel } from '../../assets/urls.js';
import type { ItemAsset, ItemRecord } from '../../types.js';
import { bodyMeshesForSlot, conflictingItems, pickAssets } from './slots.js';
import { applyFaceTextures } from './face.js';
import { FaceAnimator } from './face-animation.js';
import type { FaceExpression } from './expressions.js';
import { applyTint, type TintColors, type TintHandle } from './tint.js';
import { drawsWeapons, handNode, inHand, type HoldMode } from './weapons.js';

/** The slot of face items. */
const FACE_SLOT = 'FA';

interface Mount {
  mount: Group;
  /** The node it currently hangs from. */
  bone: string;
  /** Its own attach point (a weapon's carry point). */
  home: string;
  /** Where a weapon goes when it is held. */
  hand?: string;
  /** A node the user mounted it on, which wins over home and hand. */
  override: string;
}

interface Equipped {
  item: ItemRecord;
  slots: string[];
  /** Objects added to the rig that are removed again on unequip. */
  objects: Object3D[];
  /** Body parts hidden by this item. */
  hidden: Object3D[];
  tints: TintHandle[];
  /** Keys this item added to `nodes` (extra bones), removed again with it. */
  addedNodes: string[];
  /** Static items: a group per attached model, parented to a bone. Its transform is the item's offset. */
  mounts: Mount[];
  /** How a weapon is held (automatic follows the clip). */
  hold?: HoldMode;
  /** Why the item is switched off (the user hid it). Off items also release their body parts. */
  off: number;
  userHidden: boolean;
}

export interface BoneInfo {
  name: string;
  children: BoneInfo[];
}

/** three.js sanitises node names (spaces become underscores), so compare names in that form. */
const lower = (s: string) => PropertyBinding.sanitizeNodeName(s).toLowerCase();

function findByName(root: Object3D, name: string): Object3D | null {
  const wanted = lower(name);
  let found: Object3D | null = null;
  root.traverse((o) => {
    if (!found && lower(o.name) === wanted) found = o;
  });
  return found;
}

interface Loaded {
  object: Object3D;
  tint: TintHandle | null;
}

/** A body model plus the items worn on it. */
export class CharacterRig {
  readonly root = new Group();
  readonly gender: 0 | 1;
  /** Lowercase name -> node, for every named node of the body (bones, dummies, parts). */
  readonly nodes = new Map<string, Object3D>();
  /** Body meshes by name; items with "replace" hide the ones of their slot. */
  readonly bodyParts = new Map<string, Object3D>();
  readonly equipped = new Map<string, Equipped>();
  /** Slot -> id of the item occupying it. */
  readonly slotOwner = new Map<string, string>();
  readonly skinRoot: Object3D;
  readonly body: Object3D;
  onChange?: () => void;

  private readonly hideCount = new Map<Object3D, number>();
  private readonly tokens = new Map<string, number>();
  private disposed = false;
  private skinTint: TintHandle | null = null;
  /** The skin colours in effect: worn items' skin regions (CL_Skin, SH_Skin...) follow them. */
  private skinColors: TintColors | null = null;
  /** The eye colours in effect (the face's iris regions); without any the whole body follows the skin. */
  private eyeColors: TintColors | null = null;
  private readonly face: FaceAnimator;
  /** Whether the current clip holds weapons (a combat clip). */
  private drawn = false;

  private constructor(gender: 0 | 1, body: Object3D) {
    this.gender = gender;
    this.face = new FaceAnimator(gender);
    this.body = body;
    this.root.add(body);
    body.traverse((o) => {
      if (o.name && !this.nodes.has(lower(o.name))) this.nodes.set(lower(o.name), o);
    });
    this.skinRoot = this.nodes.get('scene_root') ?? body;
    // Every mesh of the body is a part that an item can replace (skin, face, default hair...), wherever it sits.
    body.traverse((o) => {
      if ((o as Mesh).isMesh && o.name && !this.bodyParts.has(o.name)) this.bodyParts.set(o.name, o);
    });
  }

  /** `skin` colours the body's skin masks; the face's other mask (the irises) takes `eye`, or the skin without one. */
  static async create(gender: 0 | 1, skin?: TintColors, eye?: TintColors): Promise<CharacterRig> {
    const { object } = await instantiate(bodyModel(gender));
    const rig = new CharacterRig(gender, object);
    if (skin) rig.skinColors = skin;
    if (eye) rig.eyeColors = eye;
    if (skin || eye) rig.skinTint = await applyTint(object, bodyModel(gender), eye ?? skin ?? null, skin ?? null);
    if (!rig.skinTint) {
      const face = rig.bodyParts.get(FACE_SLOT);
      if (face instanceof Mesh) {
        face.material = Array.isArray(face.material)
          ? face.material.map((material) => material.clone())
          : face.material.clone();
      }
    }
    rig.refreshFace();
    return rig;
  }

  private refreshFace() {
    const item = this.itemInSlot(FACE_SLOT);
    const equipped = item ? this.equipped.get(item.id) : undefined;
    const bodyFace = this.bodyParts.get(FACE_SLOT);
    this.face.setTargets(equipped && !equipped.userHidden ? equipped.objects : bodyFace ? [bodyFace] : []);
  }

  /** Bring everything the clip drives in line with it: the face sequence, and weapons held during combat clips. */
  followClip(clip: string, seconds: number, expression?: FaceExpression) {
    this.setWeaponsDrawn(drawsWeapons(clip));
    this.updateFace(clip, seconds, expression);
  }

  updateFace(clip: string, seconds: number, expression?: FaceExpression) {
    const item = this.itemInSlot(FACE_SLOT);
    const visibleItem = item && !this.equipped.get(item.id)?.userHidden ? item.id : undefined;
    this.face.update(clip, seconds, expression, visibleItem);
  }

  async faceReady() {
    await this.face.ready();
  }

  setEyeColors(colors: TintColors) {
    this.eyeColors = colors;
    this.skinTint?.setColors(colors);
    for (const eq of this.equipped.values())
      if (eq.slots.includes(FACE_SLOT)) for (const tint of eq.tints) tint.setColors(colors);
  }

  setSkinColors(colors: TintColors) {
    this.skinColors = colors;
    if (!this.eyeColors) this.skinTint?.setColors(colors);
    this.skinTint?.setSkinColors(colors);
    for (const eq of this.equipped.values()) for (const tint of eq.tints) tint.setSkinColors(colors);
  }

  setItemColors(itemId: string, colors: TintColors) {
    const eq = this.equipped.get(itemId);
    // A worn face follows the character's eye colour, not a colour of its own.
    if (eq?.slots.includes(FACE_SLOT) && this.eyeColors) return;
    for (const tint of eq?.tints ?? []) tint.setColors(colors);
  }

  isEquipped(itemId: string) {
    return this.equipped.has(itemId);
  }

  itemInSlot(slot: string): ItemRecord | undefined {
    const id = this.slotOwner.get(slot);
    return id ? this.equipped.get(id)?.item : undefined;
  }

  /** Node of the body (bone, dummy or part) by name, whatever the spelling of spaces and case. */
  resolve(name: string): Object3D | undefined {
    return name ? this.nodes.get(lower(name)) : undefined;
  }

  /** Every object an equipped item added to the rig (meshes, bones, mounts). */
  objectsOf(itemId: string): Object3D[] {
    return this.equipped.get(itemId)?.objects ?? [];
  }

  /** Mount groups of a static item (empty for skinned clothes), whose transform is the item's offset. */
  mountsOf(itemId: string): Group[] {
    return this.equipped.get(itemId)?.mounts.map((m) => m.mount) ?? [];
  }

  /** The bone a static item attaches to by default. */
  defaultBoneOf(itemId: string): string {
    return this.equipped.get(itemId)?.mounts[0]?.home ?? '';
  }

  /** Move the mounts of a static item to another bone (empty = the item's own default). */
  mountOn(itemId: string, bone: string) {
    const eq = this.equipped.get(itemId);
    if (!eq) return;
    for (const m of eq.mounts) {
      m.override = bone;
      this.placeMount(eq, m);
    }
  }

  /** Whether weapons are in the hand (a combat clip) or on their carry points. */
  setWeaponsDrawn(drawn: boolean) {
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    for (const eq of this.equipped.values()) for (const m of eq.mounts) if (m.hand) this.placeMount(eq, m);
  }

  /** How an item is held: following the clip, always in the hand or always carried. */
  setHold(itemId: string, mode: HoldMode | undefined) {
    const eq = this.equipped.get(itemId);
    if (!eq || eq.hold === mode) return;
    eq.hold = mode;
    for (const m of eq.mounts) if (m.hand) this.placeMount(eq, m);
  }

  /** Whether an item is a weapon that can move between its carry point and a hand. */
  isHoldable(itemId: string): boolean {
    return this.equipped.get(itemId)?.mounts.some((m) => !!m.hand) ?? false;
  }

  /** The bone a mount belongs on now: the user's choice, else the hand while held, else its own. */
  private placeMount(eq: Equipped, m: Mount) {
    const target = m.override || (m.hand && inHand(eq.hold, this.drawn) ? m.hand : m.home);
    if (!this.place(m.mount, target, eq) && target !== m.home) this.place(m.mount, m.home, eq);
  }

  /** Show or hide an item. A hidden item also gives its body parts back. */
  setItemVisible(itemId: string, visible: boolean) {
    const eq = this.equipped.get(itemId);
    if (!eq || visible === !eq.userHidden) return;
    eq.userHidden = !visible;
    if (visible) this.switchOn(eq);
    else this.switchOff(eq);
    if (eq.slots.includes(FACE_SLOT)) this.refreshFace();
  }

  /** The skeleton as a tree: bones and dummy nodes of the body, without anything added by items. */
  boneTree(): BoneInfo[] {
    const added = new Set<Object3D>();
    const collect = (eq: Equipped) => {
      for (const o of eq.objects) o.traverse((c) => added.add(c));
    };
    this.equipped.forEach(collect);
    const walk = (o: Object3D): BoneInfo[] =>
      o.children
        .filter((c) => !added.has(c) && !(c as Mesh).isMesh && c.name)
        .map((c) => ({ name: c.name, children: walk(c) }));
    return walk(this.skinRoot);
  }

  private async loadAssets(item: ItemRecord, assets: ItemAsset[], colors?: TintColors) {
    const glbs = [...new Set(assets.map((a) => a.glb))];
    const isFace = item.slots.includes(FACE_SLOT);
    const loaded: Loaded[] = await Promise.all(
      glbs.map(async (glb) => {
        const model = await instantiate(glb);
        if (isFace) await applyFaceTextures(model.object, item.id);
        // Items without palette colours still get their skin regions tinted.
        const tint =
          colors || this.skinColors ? await applyTint(model.object, glb, colors ?? null, this.skinColors) : null;
        return { object: model.object, tint };
      })
    );
    return { glbs, loaded };
  }

  /** Put an item on, replacing anything that occupies the same slots. */
  async equip(item: ItemRecord, colors?: TintColors): Promise<void> {
    const token = (this.tokens.get(item.id) ?? 0) + 1;
    this.tokens.set(item.id, token);

    const assets = pickAssets(item, this.gender);
    if (assets.length === 0) throw new Error(`${item.name} has no model for this gender`);
    // A worn face is coloured with the character's eye colour (in the game the face's colour is the eye colour).
    const tintColors = item.slots.includes(FACE_SLOT) ? (this.eyeColors ?? colors) : colors;
    const { glbs, loaded } = await this.loadAssets(item, assets, tintColors);
    if (this.disposed || this.tokens.get(item.id) !== token) return;

    const slots = [...new Set(assets.map((a) => a.slot))];
    for (const id of conflictingItems(this.slotOwner, slots, item.id)) this.unequip(id);
    if (this.equipped.has(item.id)) this.unequip(item.id);

    const eq = this.install(item, assets, glbs, loaded);
    this.equipped.set(item.id, eq);
    for (const slot of slots) this.slotOwner.set(slot, item.id);
    if (slots.includes(FACE_SLOT)) this.refreshFace();
    this.onChange?.();
  }

  unequip(itemId: string) {
    const eq = this.equipped.get(itemId);
    if (!eq) return;
    this.release(eq);
    for (const slot of eq.slots) if (this.slotOwner.get(slot) === itemId) this.slotOwner.delete(slot);
    this.equipped.delete(itemId);
    if (eq.slots.includes(FACE_SLOT)) this.refreshFace();
    this.onChange?.();
  }

  unequipSlot(slot: string) {
    const id = this.slotOwner.get(slot);
    if (id) this.unequip(id);
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.equipped.keys()]) this.unequip(id);
    this.face.dispose();
    this.root.removeFromParent();
  }

  /** Attach loaded models to the rig, hiding what they replace. Does not touch the equipped/slot maps. */
  private install(item: ItemRecord, assets: ItemAsset[], glbs: string[], loaded: Loaded[]): Equipped {
    const slots = [...new Set(assets.map((a) => a.slot))];
    const eq: Equipped = {
      item,
      slots,
      objects: [],
      hidden: [],
      tints: loaded.map((l) => l.tint).filter((t): t is TintHandle => !!t),
      addedNodes: [],
      mounts: [],
      off: 0,
      userHidden: false
    };
    // The skin may have changed while the models were loading.
    if (this.skinColors) for (const tint of eq.tints) tint.setSkinColors(this.skinColors);
    glbs.forEach((glb, i) => {
      const group = assets.filter((a) => a.glb === glb);
      const object = loaded[i].object;
      object.updateMatrixWorld(true);

      for (const asset of group) {
        if (!asset.replace) continue;
        for (const name of bodyMeshesForSlot(asset.slot, [...this.bodyParts.keys()]))
          this.hide(eq, this.bodyParts.get(name)!);
      }

      const skinned: SkinnedMesh[] = [];
      object.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
      });
      if (skinned.length) {
        this.retargetSkinned(skinned, eq);
      } else {
        // One model can serve several attach points (a pair of knuckles, one per hand): each gets its own copy.
        const seen = new Set<string>();
        const points = group.filter((a) => {
          const key = `${a.targetnode}|${handNode(a) ?? ''}`;
          if (!a.targetnode || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        (points.length ? points : [group[0]]).forEach((asset, k) =>
          this.attachStatic(k === 0 ? object : object.clone(), asset, eq)
        );
      }
    });
    return eq;
  }

  /** Take an item's objects and hidden parts off the rig again. */
  private release(eq: Equipped) {
    for (const obj of eq.objects) obj.removeFromParent();
    if (eq.off === 0) for (const part of eq.hidden) this.unhide(part);
    for (const key of eq.addedNodes) this.nodes.delete(key);
    eq.objects = [];
    eq.mounts = [];
  }

  private switchOff(eq: Equipped) {
    eq.off++;
    if (eq.off !== 1) return;
    for (const o of eq.objects) o.visible = false;
    for (const part of eq.hidden) this.unhide(part);
  }

  private switchOn(eq: Equipped) {
    if (eq.off === 0) return;
    eq.off--;
    if (eq.off !== 0) return;
    for (const o of eq.objects) o.visible = true;
    for (const part of eq.hidden) this.rehide(part);
  }

  private hide(eq: Equipped, part: Object3D) {
    if (eq.hidden.includes(part)) return;
    eq.hidden.push(part);
    this.rehide(part);
  }

  private rehide(part: Object3D) {
    this.hideCount.set(part, (this.hideCount.get(part) ?? 0) + 1);
    part.visible = false;
  }

  private unhide(part: Object3D) {
    const n = (this.hideCount.get(part) ?? 1) - 1;
    this.hideCount.set(part, n);
    if (n <= 0) part.visible = true;
  }

  /**
   * Clothes are skinned to a copy of the full skeleton. Re-bind their meshes to the body's own bones (matched by
   * name) so they follow the body's pose and animation. Bones the body lacks are moved under their parent bone.
   */
  private retargetSkinned(meshes: SkinnedMesh[], eq: Equipped) {
    const missing = new Map<string, Object3D>();
    for (const mesh of meshes) {
      for (const bone of mesh.skeleton.bones) {
        if (!this.nodes.has(lower(bone.name))) missing.set(lower(bone.name), bone);
      }
    }
    const adopt = (key: string, bone: Object3D) => {
      this.nodes.set(key, bone);
      eq.addedNodes.push(key);
      eq.objects.push(bone);
    };
    // Attach extra bones (capes, tails...) to their parent in the body, parents first.
    let progress = true;
    while (missing.size && progress) {
      progress = false;
      for (const [key, bone] of missing) {
        const parentName = bone.parent ? lower(bone.parent.name) : '';
        const parent = this.nodes.get(parentName);
        if (parent) {
          parent.add(bone);
          adopt(key, bone);
          missing.delete(key);
          progress = true;
        }
      }
    }
    for (const [key, bone] of missing) {
      this.skinRoot.add(bone);
      adopt(key, bone);
    }

    for (const mesh of meshes) {
      const bones = mesh.skeleton.bones.map((b) => this.nodes.get(lower(b.name)) ?? b);
      const skeleton = new Skeleton(bones as never, mesh.skeleton.boneInverses);
      mesh.bind(skeleton, mesh.bindMatrix);
      mesh.frustumCulled = false;
      this.skinRoot.add(mesh);
      eq.objects.push(mesh);
    }
  }

  /**
   * Static items (hair, hats, weapons) hang off a named node of the body. The item keeps its own authored local
   * transform (its node sits where the item's file puts it relative to the attach point); the mount group around
   * it carries the user's offset.
   */
  private attachStatic(object: Object3D, asset: ItemAsset, eq: Equipped) {
    const targetNode = asset.targetnode;
    const itemRoot = findByName(object, 'Scene Root') ?? object;
    // The item's own node already carries the same local transform the hidden part had.
    itemRoot.position.set(0, 0, 0);
    itemRoot.quaternion.identity();
    itemRoot.scale.set(1, 1, 1);
    const mount = new Group();
    mount.add(itemRoot);
    const entry: Mount = { mount, bone: targetNode, home: targetNode, hand: handNode(asset), override: '' };
    eq.mounts.push(entry);
    eq.objects.push(mount);
    if (!this.resolve(targetNode)) console.warn(`No attach node "${targetNode}" on the body for ${eq.item.name}`);
    this.placeMount(eq, entry);
  }

  /** Parent a mount to a bone. A hidden body part (the default hair) cannot be the parent or the item would vanish with it. */
  private place(mount: Group, boneName: string, eq: Equipped): boolean {
    const target = this.resolve(boneName);
    if (!target) return false;
    const hiddenTarget = (this.hideCount.get(target) ?? 0) > 0 && target.parent;
    (hiddenTarget ? target.parent! : target).add(mount);
    const entry = eq.mounts.find((m) => m.mount === mount);
    if (entry) entry.bone = boneName;
    return true;
  }
}
