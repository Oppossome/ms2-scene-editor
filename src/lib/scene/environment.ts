import type { MapEnvironment } from '../types.js';

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

/** In the game the camera sits about this far from what it looks at, and the fog distances are measured from it. */
export const GAME_CAMERA_DISTANCE = 1100;

/**
 * Fog distances for a camera `distance` away from its target. The map's fog is set for the game camera, so the range
 * is moved with the camera: at the game distance it is exactly the map's, further out the same stretch of fog begins
 * further away, so a map seen from far away is not drowned in it.
 */
export function fogRange(fog: { near: number; far: number }, distance: number): { near: number; far: number } {
  const shift = distance - GAME_CAMERA_DISTANCE;
  const near = Math.max(0, fog.near + shift);
  return { near, far: Math.max(near + 1, fog.far + shift) };
}
