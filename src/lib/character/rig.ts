import { Group, Mesh, Object3D, PropertyBinding, Skeleton, SkinnedMesh } from 'three';
import { instantiate } from '../assets/loader.js';
import { bodyModel } from '../assets/urls.js';
import type { ItemRecord } from '../types.js';
import { bodyMeshesForSlot, conflictingItems, pickAssets } from './slots.js';
import { applyTint, type TintColors, type TintHandle } from './tint.js';

interface Equipped {
  item: ItemRecord;
  slots: string[];
  /** Objects added to the rig that are removed again on unequip. */
  objects: Object3D[];
  /** Body parts hidden by this item. */
  hidden: Object3D[];
  tints: TintHandle[];
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
  onChange?: () => void;

  private readonly hideCount = new Map<Object3D, number>();
  private readonly tokens = new Map<string, number>();
  private disposed = false;
  private skinTint: TintHandle | null = null;

  private constructor(gender: 0 | 1, body: Object3D) {
    this.gender = gender;
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

  static async create(gender: 0 | 1, skin?: TintColors): Promise<CharacterRig> {
    const { object } = await instantiate(bodyModel(gender));
    const rig = new CharacterRig(gender, object);
    if (skin) rig.skinTint = await applyTint(object, bodyModel(gender), skin);
    return rig;
  }

  setSkinColors(colors: TintColors) {
    this.skinTint?.setColors(colors);
  }

  setItemColors(itemId: string, colors: TintColors) {
    for (const tint of this.equipped.get(itemId)?.tints ?? []) tint.setColors(colors);
  }

  isEquipped(itemId: string) {
    return this.equipped.has(itemId);
  }

  itemInSlot(slot: string): ItemRecord | undefined {
    const id = this.slotOwner.get(slot);
    return id ? this.equipped.get(id)?.item : undefined;
  }

  /** Put an item on, replacing anything that occupies the same slots. */
  async equip(item: ItemRecord, colors?: TintColors): Promise<void> {
    const token = (this.tokens.get(item.id) ?? 0) + 1;
    this.tokens.set(item.id, token);

    const assets = pickAssets(item, this.gender);
    if (assets.length === 0) throw new Error(`${item.name} has no model for this gender`);

    const glbs = [...new Set(assets.map((a) => a.glb))];
    const loaded = await Promise.all(
      glbs.map(async (glb) => {
        const model = await instantiate(glb);
        const tint = colors ? await applyTint(model.object, glb, colors) : null;
        return { ...model, tint };
      })
    );
    if (this.disposed || this.tokens.get(item.id) !== token) return;

    const slots = [...new Set(assets.map((a) => a.slot))];
    for (const id of conflictingItems(this.slotOwner, slots, item.id)) this.unequip(id);
    if (this.equipped.has(item.id)) this.unequip(item.id);

    const eq: Equipped = { item, slots, objects: [], hidden: [], tints: loaded.map((l) => l.tint).filter((t): t is TintHandle => !!t) };
    glbs.forEach((glb, i) => {
      const group = assets.filter((a) => a.glb === glb);
      const object = loaded[i].object;
      object.updateMatrixWorld(true);

      for (const asset of group) {
        if (!asset.replace) continue;
        for (const name of bodyMeshesForSlot(asset.slot, [...this.bodyParts.keys()])) this.hide(eq, this.bodyParts.get(name)!);
      }

      const skinned: SkinnedMesh[] = [];
      object.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
      });
      if (skinned.length) {
        this.retargetSkinned(object, skinned, eq);
      } else {
        const asset = group.find((a) => a.targetnode) ?? group[0];
        this.attachStatic(object, asset.selfnode, asset.targetnode, eq);
      }
    });

    this.equipped.set(item.id, eq);
    for (const slot of slots) this.slotOwner.set(slot, item.id);
    this.onChange?.();
  }

  unequip(itemId: string) {
    const eq = this.equipped.get(itemId);
    if (!eq) return;
    for (const obj of eq.objects) obj.removeFromParent();
    for (const part of eq.hidden) this.unhide(part);
    for (const slot of eq.slots) if (this.slotOwner.get(slot) === itemId) this.slotOwner.delete(slot);
    this.equipped.delete(itemId);
    this.onChange?.();
  }

  unequipSlot(slot: string) {
    const id = this.slotOwner.get(slot);
    if (id) this.unequip(id);
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.equipped.keys()]) this.unequip(id);
    this.root.removeFromParent();
  }

  private hide(eq: Equipped, part: Object3D) {
    if (eq.hidden.includes(part)) return;
    eq.hidden.push(part);
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
  private retargetSkinned(itemRoot: Object3D, meshes: SkinnedMesh[], eq: Equipped) {
    const missing = new Map<string, Object3D>();
    for (const mesh of meshes) {
      for (const bone of mesh.skeleton.bones) {
        if (!this.nodes.has(lower(bone.name))) missing.set(lower(bone.name), bone);
      }
    }
    // Attach extra bones (capes, tails...) to their parent in the body, parents first.
    let progress = true;
    while (missing.size && progress) {
      progress = false;
      for (const [key, bone] of missing) {
        const parentName = bone.parent ? lower(bone.parent.name) : '';
        const parent = this.nodes.get(parentName);
        if (parent) {
          parent.add(bone);
          this.nodes.set(key, bone);
          eq.objects.push(bone);
          missing.delete(key);
          progress = true;
        }
      }
    }
    for (const [key, bone] of missing) {
      this.skinRoot.add(bone);
      this.nodes.set(key, bone);
      eq.objects.push(bone);
    }

    for (const mesh of meshes) {
      const bones = mesh.skeleton.bones.map((b) => this.nodes.get(lower(b.name)) ?? b);
      const skeleton = new Skeleton(bones as never, mesh.skeleton.boneInverses);
      mesh.bind(skeleton, mesh.bindMatrix);
      mesh.frustumCulled = false;
      this.skinRoot.add(mesh);
      eq.objects.push(mesh);
    }
    void itemRoot;
  }

  /**
   * Static items (hair, hats, weapons) hang off a named node of the body. The item keeps its own authored local
   * transform (its node sits where the item's file puts it relative to the attach point).
   */
  private attachStatic(object: Object3D, _selfNode: string, targetNode: string, eq: Equipped) {
    const itemRoot = findByName(object, 'Scene Root') ?? object;
    const target = targetNode ? this.nodes.get(lower(targetNode)) : undefined;
    if (!target) {
      console.warn(`No attach node "${targetNode}" on the body for ${eq.item.name}`);
      return;
    }
    // A hidden body part (the default hair) cannot be the parent or the item would vanish with it.
    const hiddenTarget = (this.hideCount.get(target) ?? 0) > 0 && target.parent;
    const parent = hiddenTarget ? target.parent! : target;
    // The item's own node already carries the same local transform the hidden part had.
    itemRoot.position.set(0, 0, 0);
    itemRoot.quaternion.identity();
    itemRoot.scale.set(1, 1, 1);
    parent.add(itemRoot);
    eq.objects.push(itemRoot);
  }
}
