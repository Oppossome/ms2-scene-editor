import {
  Color,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  TextureLoader,
  type Material,
  type Mesh,
  type Object3D,
  type Texture
} from 'three';
import { modelUrl } from '../assets/urls.js';
import type { PaletteColor } from '../types.js';

/** Three palette colours: the item's tint channels ch0, ch1 and ch2. */
export interface TintColors {
  c0: Color;
  c1: Color;
  c2: Color;
}

/** "0xffaa2f2f" (ARGB) -> Color; the alpha byte is ignored. */
export function argbToColor(hex: string): Color {
  const digits = hex.replace(/^0x/i, '');
  return new Color(parseInt(digits.slice(-6), 16));
}

export function paletteToTint(color: PaletteColor): TintColors {
  return { c0: argbToColor(color.ch0), c1: argbToColor(color.ch1), c2: argbToColor(color.ch2) };
}

/**
 * Whether a colour-mask texture belongs to the body's skin (the skin parts of clothes, `CL_Skin`, `SH_Skin`...,
 * use the body masks `m_body_c.png` / `f_skin_body_c.png`). Those regions take the character's skin colours, not
 * the colours chosen for the item.
 */
export function isSkinMask(uri: string): boolean {
  let name = uri.split(/[\\/]/).pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw name
  }
  return /^(m|f)_(skin_)?body_c\.png$/i.test(name);
}

/** Constants shared by the shader and the CPU bake so both produce the same colours. */
export const TINT = { gain: 2.2, coverageBoost: 1.8, amount: 1 };

type Rgb = [number, number, number];

/**
 * CPU version of the tint shader for one pixel. `base` is the linear diffuse colour (texture times material colour),
 * `mask` the raw 0..1 mask channels, and `t0..t2` the linear palette colours.
 */
export function tintPixel(base: Rgb, mask: Rgb, t0: Rgb, t1: Rgb, t2: Rgb): Rgb {
  const neutral = Math.min(mask[0], mask[1], mask[2]);
  const w: Rgb = [mask[0] - neutral, mask[1] - neutral, mask[2] - neutral];
  const coverage = Math.min(Math.max(Math.max(w[0], w[1], w[2]) * TINT.coverageBoost, 0), 1);
  const total = Math.max(w[0] + w[1] + w[2], 1e-4);
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const level = Math.min(Math.max(lum * TINT.gain, 0), 1.5);
  const k = coverage * TINT.amount;
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const target = (w[0] * t0[i] + w[1] * t1[i] + w[2] * t2[i]) / total;
    out[i] = base[i] + (target * level - base[i]) * k;
  }
  return out;
}

/** What a tinted material was built from; the exporter uses it to bake the tint into a texture. */
export interface TintInfo {
  mask: Texture;
  colors: () => TintColors;
}
const tintInfo = new WeakMap<Material, TintInfo>();
export const getTintInfo = (material: Material) => tintInfo.get(material);

export interface TintHandle {
  /** True when at least one material of the object is tintable. */
  active: boolean;
  /** Change the item's palette colours (a no-op when the object was set up without any). */
  setColors(colors: TintColors): void;
  /** Change the skin colours used by the object's skin regions (a no-op when it has none). */
  setSkinColors(colors: TintColors): void;
}

const loader = new TextureLoader();
const maskCache = new Map<string, Promise<Texture>>();

function loadMask(url: string): Promise<Texture> {
  let hit = maskCache.get(url);
  if (!hit) {
    hit = loader.loadAsync(url).then((tex) => {
      tex.flipY = false; // same orientation as glTF textures
      tex.colorSpace = NoColorSpace; // the mask is data, not colour
      tex.wrapS = tex.wrapT = RepeatWrapping;
      return tex;
    });
    hit.catch(() => maskCache.delete(url));
    maskCache.set(url, hit);
  }
  return hit;
}

/**
 * Mask channels (R, G, B) select the tint regions ch0/ch1/ch2; where all three are equal the surface is left alone.
 * Tinted regions keep the base texture's lightness and take the palette colour.
 */
const FRAGMENT_PATCH = /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
{
  vec3 m = texture2D(tintMask, vMapUv).rgb;
  float neutral = min(min(m.r, m.g), m.b);
  vec3 w = m - vec3(neutral);
  float coverage = clamp(max(w.r, max(w.g, w.b)) * ${TINT.coverageBoost.toFixed(2)}, 0.0, 1.0);
  float total = max(w.r + w.g + w.b, 1e-4);
  vec3 target = (w.r * tint0 + w.g * tint1 + w.b * tint2) / total;
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 tinted = target * clamp(lum * tintGain, 0.0, 1.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, tinted, coverage * tintAmount);
}
#endif
`;

interface UniformSet {
  tint0: { value: Color };
  tint1: { value: Color };
  tint2: { value: Color };
  tintGain: { value: number };
  tintAmount: { value: number };
}

const uniformsFor = (colors: TintColors): UniformSet => ({
  tint0: { value: colors.c0.clone() },
  tint1: { value: colors.c1.clone() },
  tint2: { value: colors.c2.clone() },
  tintGain: { value: TINT.gain },
  tintAmount: { value: TINT.amount }
});

const setUniforms = (u: UniformSet, c: TintColors) => {
  u.tint0.value.copy(c.c0);
  u.tint1.value.copy(c.c1);
  u.tint2.value.copy(c.c2);
};

/**
 * Give an object's tintable materials (those listing a colour mask in extras.ms2.shader0) a per-instance clone.
 * Regions masked with a body mask (the skin parts of clothes) are driven by the `skin` colours, everything else by
 * the item's `colors`; a material whose colours are missing is left as it is. Returns null when nothing is tintable.
 */
export async function applyTint(
  root: Object3D,
  glbRel: string,
  colors: TintColors | null,
  skin: TintColors | null = null
): Promise<TintHandle | null> {
  const base = new URL(modelUrl(glbRel), globalThis.location?.href ?? 'http://localhost/');
  const item = colors ? uniformsFor(colors) : null;
  const skinU = skin ? uniformsFor(skin) : null;

  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });

  const clones = new Map<Material, Material>();
  let active = false;
  for (const mesh of meshes) {
    const original = mesh.material as Material;
    if (Array.isArray(original)) continue;
    const maskUri = (original.userData as { ms2?: { shader0?: string } })?.ms2?.shader0;
    if (!maskUri || !(original instanceof MeshStandardMaterial) || !original.map) continue;
    const uniforms = isSkinMask(maskUri) ? skinU : item;
    if (!uniforms) continue;

    let clone = clones.get(original);
    if (!clone) {
      const mask = await loadMask(new URL(maskUri, base).href);
      const material = original.clone();
      material.userData = { ...original.userData };
      material.customProgramCacheKey = () => 'ms2-tint';
      material.onBeforeCompile = (shader) => {
        shader.uniforms.tintMask = { value: mask };
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform sampler2D tintMask;\nuniform vec3 tint0;\nuniform vec3 tint1;\nuniform vec3 tint2;\nuniform float tintGain;\nuniform float tintAmount;'
          )
          .replace('#include <map_fragment>', FRAGMENT_PATCH);
      };
      tintInfo.set(material, {
        mask,
        colors: () => ({ c0: uniforms.tint0.value, c1: uniforms.tint1.value, c2: uniforms.tint2.value })
      });
      clone = material;
      clones.set(original, clone);
    }
    mesh.material = clone;
    active = true;
  }

  if (!active) return null;
  return {
    active,
    setColors(c: TintColors) {
      if (item) setUniforms(item, c);
    },
    setSkinColors(c: TintColors) {
      if (skinU) setUniforms(skinU, c);
    }
  };
}
