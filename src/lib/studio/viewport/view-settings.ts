import type { MapEnvironment } from '../../types.js';

/** Where a viewport's backdrop comes from. */
export type BackgroundMode = 'map' | 'none' | 'image';

/** The View menu's settings for the main viewport's surroundings. */
export interface ViewSettings {
  /** The map's backdrop, none (the plain gradient) or a chosen image. */
  background: BackgroundMode;
  /** The chosen image (name without extension) while `background` is `image`. */
  image: string | null;
  /** Show the map's distance fog. */
  fog: boolean;
}

export const DEFAULT_VIEW: ViewSettings = { background: 'map', image: null, fog: true };

/** The View settings from untrusted saved JSON; anything unusable falls back to the default. */
export function parseView(value: unknown): ViewSettings {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const image = typeof o.image === 'string' && /^[\w .-]+$/.test(o.image) ? o.image : null;
  const background: BackgroundMode = o.background === 'none' ? 'none' : o.background === 'image' && image ? 'image' : 'map';
  return { background, image, fog: o.fog !== false };
}

/** Path under `converted/textures` of a backdrop image. */
export const backdropPath = (name: string) => `Resource/Image/bg/${name}.png`;

/** The backdrop and fog to draw, from the View settings and what the scene's map sets. */
export function resolveEnvironment(view: ViewSettings, map: MapEnvironment | null | undefined): MapEnvironment {
  const out: MapEnvironment = {};
  if (view.background === 'map') {
    if (map?.background) out.background = map.background;
  } else if (view.background === 'image' && view.image) {
    out.background = backdropPath(view.image);
  }
  if (view.fog && map?.fog) out.fog = map.fog;
  return out;
}
