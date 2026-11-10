import {
  CanvasTexture,
  SRGBColorSpace,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D
} from 'three';
import { getTintInfo, tintPixel, type MaskPixel } from '../entities/character/tint.js';

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => {
  const v = Math.min(Math.max(c, 0), 1);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
type Rgb = [number, number, number];

type Drawable = CanvasImageSource & { width: number; height: number };

function readPixels(image: Drawable, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * A copy of a tinted material whose diffuse texture already contains the tint, so it exports as plain glTF.
 * Returns null when the material is not tinted or its images are unavailable.
 */
export function bakeTintedMaterial(material: MeshStandardMaterial): MeshStandardMaterial | null {
  const info = getTintInfo(material);
  if (!info?.enabled) return null;
  const base = material.map?.image as Drawable | undefined;
  const mask = info?.mask.image as Drawable | undefined;
  if (!info || !base || !mask) return null;

  // The base and the mask can differ in size (a flat colour base is tiny), the larger one carries the detail.
  const width = Math.max(base.width, mask.width);
  const height = Math.max(base.height, mask.height);
  const basePixels = readPixels(base, width, height);
  const maskPixels = readPixels(mask, width, height);
  const { c0, c1, c2 } = info.colors();
  const factor = material.color;
  // The material colour multiplies the tint as well as the texture, as in the shader.
  const scaled = (c: { r: number; g: number; b: number }): Rgb => [c.r * factor.r, c.g * factor.g, c.b * factor.b];
  const t0 = scaled(c0);
  const t1 = scaled(c1);
  const t2 = scaled(c2);

  const out = new ImageData(width, height);
  for (let i = 0; i < basePixels.length; i += 4) {
    const linear: Rgb = [
      toLinear(basePixels[i] / 255) * factor.r,
      toLinear(basePixels[i + 1] / 255) * factor.g,
      toLinear(basePixels[i + 2] / 255) * factor.b
    ];
    const m: MaskPixel = [
      maskPixels[i] / 255,
      maskPixels[i + 1] / 255,
      maskPixels[i + 2] / 255,
      maskPixels[i + 3] / 255
    ];
    const result = tintPixel(linear, m, t0, t1, t2);
    out.data[i] = toSrgb(result[0]) * 255;
    out.data[i + 1] = toSrgb(result[1]) * 255;
    out.data[i + 2] = toSrgb(result[2]) * 255;
    out.data[i + 3] = basePixels[i + 3];
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false; // glTF orientation, like the source image
  texture.channel = material.map!.channel;

  const baked = material.clone();
  baked.map = texture;
  baked.color.setRGB(1, 1, 1);
  return baked;
}

/**
 * Swap every tinted material under `root` for its baked copy. Returns a function that puts the originals back.
 */
export function bakeTints(root: Object3D): () => void {
  const swapped: [Mesh, Material][] = [];
  const baked = new Map<Material, MeshStandardMaterial | null>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const material = mesh.material as MeshStandardMaterial;
    if (!getTintInfo(material)) return;
    if (!baked.has(material)) baked.set(material, bakeTintedMaterial(material));
    const copy = baked.get(material);
    if (copy) {
      swapped.push([mesh, material]);
      mesh.material = copy;
    }
  });
  return () => {
    for (const [mesh, material] of swapped) mesh.material = material;
    for (const copy of baked.values()) {
      copy?.map?.dispose();
      copy?.dispose();
    }
  };
}
