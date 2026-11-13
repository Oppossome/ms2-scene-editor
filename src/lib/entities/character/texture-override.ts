import type { Material, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { isSkinMask } from './tint.js';

/**
 * Texture overrides: the user's own images in place of an item's colour maps (the game's UGC designs). A texture is
 * named by its file name in the model (`01400009_m_ugc01_d.png`), which `assets/loader.ts` records on each map as
 * `userData.uri`, and the URL of the original as `userData.url`.
 */

export interface ItemTexture {
  /** The texture's file name, lower case: the key overrides are stored under. */
  key: string;
  /** Where the original image can be downloaded. */
  url: string;
}

/** File name of a texture URI, lower case ("../../textures/.../01400009_m_ugc01_d.png" -> "01400009_m_ugc01_d.png"). */
export function textureKey(uri: string): string {
  let name = uri.split(/[\\/]/).pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw name
  }
  return name.toLowerCase();
}

/** Each overridden mesh's material before the override, to restore it. */
const originals = new WeakMap<Mesh, Material>();

type Mapped = MeshStandardMaterial & { map: Texture };

/** The material a mesh has without overrides, when it is a single material with a colour map. */
function baseMaterial(mesh: Mesh): Mapped | null {
  const material = (originals.get(mesh) ?? mesh.material) as Material | Material[] | undefined;
  if (!material || Array.isArray(material)) return null;
  const map = (material as Partial<MeshStandardMaterial>).map;
  return map ? (material as Mapped) : null;
}

/** The skin parts of clothes (masked with the body masks) take the body's look and are not the item's own. */
const isSkinPart = (material: Material) =>
  isSkinMask((material.userData as { ms2?: { shader0?: string } }).ms2?.shader0 ?? '');

function meshesOf(objects: readonly Object3D[]): Mesh[] {
  const meshes = new Set<Mesh>();
  for (const object of objects)
    object.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.add(o as Mesh);
    });
  return [...meshes];
}

/** The item's own colour maps (skin parts left out), once each, in model order. */
export function listItemTextures(objects: readonly Object3D[]): ItemTexture[] {
  const found = new Map<string, ItemTexture>();
  for (const mesh of meshesOf(objects)) {
    const material = baseMaterial(mesh);
    const uri = material?.map.userData.uri as string | undefined;
    if (!material || !uri || isSkinPart(material)) continue;
    const key = textureKey(uri);
    if (!found.has(key)) found.set(key, { key, url: (material.map.userData.url as string | undefined) ?? uri });
  }
  return [...found.values()];
}

function release(material: Material) {
  (material as Partial<MeshStandardMaterial>).map?.dispose();
  material.dispose();
}

/**
 * Show `overrides` (texture key -> image) on the item's meshes and put every other mesh back to its own material.
 * Materials are shared with the model cache (or are the item's tint clone), so an overridden mesh gets a copy whose
 * map is the image, with the original map's sampling settings. The copy has no tint shader: a design shows as drawn,
 * and GLB export writes it as it is instead of baking a tint into it.
 */
export function applyTextureOverrides(objects: readonly Object3D[], overrides: ReadonlyMap<string, Texture>) {
  // Copies in use after this call, per base material; copies replaced here are released once at the end.
  const made = new Map<Material, Material>();
  const stale = new Set<Material>();
  for (const mesh of meshesOf(objects)) {
    const base = baseMaterial(mesh);
    const uri = base?.map.userData.uri as string | undefined;
    const image = base && uri && !isSkinPart(base) ? overrides.get(textureKey(uri)) : undefined;
    const current = mesh.material as Material;
    if (!base || !image) {
      if (originals.has(mesh)) {
        stale.add(current);
        mesh.material = originals.get(mesh)!;
        originals.delete(mesh);
      }
      continue;
    }
    const kept = originals.has(mesh) && (current as Partial<MeshStandardMaterial>).map?.source === image.source;
    if (kept && !made.has(base)) {
      made.set(base, current);
      continue;
    }
    let copy = made.get(base);
    if (!copy) {
      const material = base.clone();
      const map = image.clone();
      map.flipY = base.map.flipY;
      map.colorSpace = base.map.colorSpace;
      map.wrapS = base.map.wrapS;
      map.wrapT = base.map.wrapT;
      map.channel = base.map.channel;
      map.userData = { ...base.map.userData, override: true };
      map.needsUpdate = true;
      material.map = map;
      copy = material;
      made.set(base, copy);
    }
    if (originals.has(mesh)) stale.add(current);
    else originals.set(mesh, base);
    mesh.material = copy;
  }
  const inUse = new Set(made.values());
  for (const material of stale) if (!inUse.has(material)) release(material);
}

/** Put every overridden mesh back to its own material. */
export const resetTextureOverrides = (objects: readonly Object3D[]) => applyTextureOverrides(objects, new Map());
