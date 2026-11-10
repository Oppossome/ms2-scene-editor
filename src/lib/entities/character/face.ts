import { Mesh, RepeatWrapping, SRGBColorSpace, TextureLoader, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { assetUrl } from '../../assets/urls.js';
import { isSkinMask } from './tint.js';

/** Face items all share two face meshes (a male and a female one); each one's look is its own texture set. */
const FACE_TEXTURES = 'converted/textures/Resource/Model/Textures/item_face';

export interface FaceTextures {
  /** The idle face. */
  base: string;
  /** Its colour mask: the alpha is the irises (see `tintPixel`). */
  mask: string;
}

/**
 * Where a face item keeps its textures: the folder named after its id without the leading 1 (10300002 -> 00300002),
 * holding one image per expression, `01_idle` and `02_idle_c` being the idle face and its mask.
 */
export function faceTextureUrls(itemId: string): FaceTextures | null {
  const n = Number(itemId) - 10_000_000;
  if (!/^\d+$/.test(itemId) || !Number.isInteger(n) || n < 0 || n >= 10_000_000) return null;
  const dir = `${FACE_TEXTURES}/${String(n).padStart(8, '0')}`;
  return { base: assetUrl(`${dir}/01_idle.png`), mask: assetUrl(`${dir}/02_idle_c.png`) };
}

const loader = new TextureLoader();
const textureCache = new Map<string, Promise<Texture>>();

function loadTexture(url: string): Promise<Texture> {
  let hit = textureCache.get(url);
  if (!hit) {
    hit = loader.loadAsync(url);
    hit.catch(() => textureCache.delete(url));
    textureCache.set(url, hit);
  }
  return hit;
}

/**
 * Give a face model the textures of a face item: its idle face as the diffuse map and its mask as the colour mask.
 * The skin parts of the model are left alone. Materials are shared with the model cache, so each is cloned first. Returns false (leaving the model as it is)
 * when the item has no textures of its own, as for a few special faces.
 */
export async function applyFaceTextures(object: Object3D, itemId: string): Promise<boolean> {
  const urls = faceTextureUrls(itemId);
  if (!urls) return false;
  let base: Texture;
  try {
    base = await loadTexture(urls.base);
  } catch {
    return false;
  }

  const clones = new Map<Material, Material>();
  object.traverse((o) => {
    const mesh = o as Mesh;
    const original = mesh.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
    if (!mesh.isMesh || !original || Array.isArray(original) || !original.map) return;
    // The head skin (FA_Skin) is part of the model too: it keeps the body's skin texture and mask.
    if (isSkinMask((original.userData as { ms2?: { shader0?: string } }).ms2?.shader0 ?? '')) return;
    let clone = clones.get(original);
    if (!clone) {
      const material = original.clone();
      // Same texture settings as the glTF loader gave the original map.
      const map = base;
      map.flipY = original.map.flipY;
      map.colorSpace = SRGBColorSpace;
      map.wrapS = map.wrapT = RepeatWrapping;
      map.channel = original.map.channel;
      material.map = map;
      const ms2 = (material.userData as { ms2?: Record<string, string> }).ms2 ?? {};
      material.userData = { ...material.userData, ms2: { ...ms2, shader0: urls.mask } };
      clone = material;
      clones.set(original, clone);
    }
    mesh.material = clone;
  });
  return clones.size > 0;
}
