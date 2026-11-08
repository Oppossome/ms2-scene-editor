const ASSET_BASE = '/api/assets';

const encodePath = (p: string) =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

/** URL of any file under the allowed extracted folders (e.g. "converted/models/Npc/..."). */
export const assetUrl = (path: string) => `${ASSET_BASE}/${encodePath(path)}`;

/** URL of a converted model given its path relative to converted/models. */
export const modelUrl = (rel: string) => assetUrl(`converted/models/${rel}`);

/** URL of an item/inventory icon given the path from the index ("Resource/Image/..."). */
export const iconUrl = (icon: string) => (icon ? assetUrl(icon) : '');

/**
 * URL of the preview PNG a model's source NIF carried in its header, extracted next to the converted models under
 * `converted/model-previews/` with the same relative path. Not every model has one: callers must tolerate a 404.
 */
export function previewUrlForModel(glb: string): string {
  const rel = glb.replace(/\\/g, '/').replace(/\.glb$/i, '');
  return rel ? assetUrl(`converted/model-previews/${rel}.png`) : '';
}

export const bodyModel = (gender: 0 | 1) => (gender === 0 ? 'Character/male/m_body.glb' : 'Character/female/f_body.glb');

/** Folder holding the per-clip skeleton-only GLBs of a body model. */
export const bodyClipDir = (gender: 0 | 1) =>
  gender === 0 ? 'Character/male/m_body.anims' : 'Character/female/f_body.anims';
