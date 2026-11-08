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

export const bodyModel = (gender: 0 | 1) => (gender === 0 ? 'Character/male/m_body.glb' : 'Character/female/f_body.glb');

/** Folder holding the per-clip skeleton-only GLBs of a body model. */
export const bodyClipDir = (gender: 0 | 1) =>
  gender === 0 ? 'Character/male/m_body.anims' : 'Character/female/f_body.anims';
