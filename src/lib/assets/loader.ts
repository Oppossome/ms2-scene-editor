import type { AnimationClip, Group, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelUrl } from './urls';

export interface LoadedModel {
  scene: Group;
  animations: AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel>>();

/** Load (and cache) a converted model by its path relative to converted/models. */
export function loadModel(rel: string): Promise<LoadedModel> {
  const key = rel.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = loader.loadAsync(modelUrl(rel)).then((gltf) => ({ scene: gltf.scene, animations: gltf.animations }));
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
