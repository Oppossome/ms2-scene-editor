import { Color, SRGBColorSpace } from 'three';

/** Distance fog for a viewport: a colour (0..255 sRGB) and the range the game camera sees it over. */
export interface FogSpec {
  color: [number, number, number];
  near: number;
  far: number;
}

/** The fog colour as a three.js colour (the values are sRGB, like the backdrop image it blends into). */
export const fogColor = ([r, g, b]: [number, number, number]) => new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
