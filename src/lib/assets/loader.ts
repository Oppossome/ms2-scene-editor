import type { AnimationClip, Group, Material, Mesh, Object3D, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelUrl } from './urls';

export interface LoadedModel {
  scene: Group;
  animations: AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel>>();

interface GltfJson {
  textures?: { source?: number }[];
  images?: { uri?: string }[];
}

/**
 * Record on each colour map the image it was loaded from, which three.js does not keep: `texture.userData.uri` as the
 * model names it and `texture.userData.url`, resolved against `modelHref` (where the original can be downloaded).
 * Texture overrides name a texture by its file name.
 */
export function tagTextureUris(gltf: Pick<GLTF, 'scene' | 'parser'>, modelHref: string) {
  const base = new URL(modelHref, globalThis.location?.href ?? 'http://localhost/');
  const json = gltf.parser.json as GltfJson;
  gltf.scene.traverse((o) => {
    const materials = (o as Mesh).material as Material | Material[] | undefined;
    for (const material of [materials].flat()) {
      const map = (material as { map?: Texture | null } | undefined)?.map;
      if (!map || map.userData.uri) continue;
      const index = gltf.parser.associations.get(map)?.textures;
      const source = index === undefined ? undefined : json.textures?.[index]?.source;
      const uri = source === undefined ? undefined : json.images?.[source]?.uri;
      if (!uri) continue;
      map.userData.uri = uri;
      const url = new URL(uri, base);
      map.userData.url = url.origin === base.origin ? url.pathname : url.href;
    }
  });
}

/** Load (and cache) a converted model by its path relative to converted/models. */
export function loadModel(rel: string): Promise<LoadedModel> {
  const key = rel.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = loader.loadAsync(modelUrl(rel)).then((gltf) => {
      tagTextureUris(gltf, modelUrl(rel));
      return { scene: gltf.scene, animations: gltf.animations };
    });
    hit.catch(() => cache.delete(key)); // allow retry after a failure
    cache.set(key, hit);
  }
  return hit;
}

/**
 * A fresh, independent copy of a loaded model (skeletons and bones are cloned too).
 * Geometry, materials and textures are shared with the cache.
 */
export async function instantiate(rel: string): Promise<{ object: Object3D; animations: AnimationClip[] }> {
  const model = await loadModel(rel);
  return { object: SkeletonUtils.clone(model.scene), animations: model.animations };
}

/** Clips only (used for skeleton-only animation files). */
export async function loadClips(rel: string): Promise<AnimationClip[]> {
  return (await loadModel(rel)).animations;
}
