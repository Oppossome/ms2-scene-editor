import { Color, SRGBColorSpace } from 'three';

/** Distance fog for a viewport: a colour (0..255 sRGB) and the range the game camera sees it over. */
export interface FogSpec {
  color: [number, number, number];
  near: number;
  far: number;
}

/** The fog colour as a three.js colour (the values are sRGB, like the backdrop image it blends into). */
export const fogColor = ([r, g, b]: [number, number, number]) =>
  new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);

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
