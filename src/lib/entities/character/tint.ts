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
import { modelUrl } from '../../assets/urls.js';
import type { PaletteColor } from '../../types.js';

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
 * One dye: a palette row (an index into the palette, i.e. `colorSN`; the game's "Basic Colors") or a custom colour
 * as lower-case `#rrggbb` (the game's "Custom" tab).
 */
export type Dye = number | string;

export const CUSTOM_DYE = /^#[0-9a-f]{6}$/;

/**
 * The detail/shade colour (ch2) of a custom colour set. The gear palettes shade ch2 to roughly 45% of ch0 in gamma
 * space, so a custom main colour gets the same darkening.
 */
export function customShade(hex: string): string {
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.45)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

/**
 * Dyes the player picked per channel. A channel without an entry follows the item's colour set; `ch0` is the main
 * colour and `ch2` the detail/shade colour. The accent `ch1` is not pickable (no item allows it), so it always comes
 * from the colour set.
 */
export interface ChannelDyes {
  ch0?: Dye;
  ch2?: Dye;
}

export const CHANNEL_KEYS = ['ch0', 'ch2'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

const isDye = (v: unknown): v is Dye =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 0) || (typeof v === 'string' && CUSTOM_DYE.test(v));

/** Validate untrusted JSON into channel picks; null when it holds nothing usable. */
export function parseChannelDyes(value: unknown): ChannelDyes | null {
  if (!value || typeof value !== 'object') return null;
  const out: ChannelDyes = {};
  for (const key of CHANNEL_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (isDye(v)) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The colour (ARGB or `#rrggbb`) a dye gives one channel; undefined for a palette row that does not exist. A custom
 * colour set shades its detail channel; a custom pick for one channel is that exact colour.
 */
function dyeChannel(
  palette: PaletteColor[],
  dye: Dye | undefined,
  key: 'ch0' | 'ch1' | 'ch2',
  isSet: boolean
): string | undefined {
  if (typeof dye === 'string') return isSet && key === 'ch2' ? customShade(dye) : dye;
  return dye === undefined ? undefined : palette[dye]?.[key];
}

/**
 * The three tint colours for a palette: every channel takes its colour from the base dye (the colour set), except
 * those the player dyed separately (a palette row's colour *for that channel*, or a custom colour). An unknown base
 * row falls back to row 0, an unknown pick to the base.
 */
export function tintFromPalette(
  palette: PaletteColor[],
  base: Dye,
  picks?: ChannelDyes | null
): TintColors | undefined {
  const set = typeof base === 'string' || palette[base] ? base : palette.length ? 0 : undefined;
  if (set === undefined) return undefined;
  const colour = (key: 'ch0' | 'ch1' | 'ch2') =>
    argbToColor(
      (key === 'ch1' ? undefined : dyeChannel(palette, picks?.[key], key, false)) ??
        dyeChannel(palette, set, key, true)!
    );
  return { c0: colour('ch0'), c1: colour('ch1'), c2: colour('ch2') };
}

/** The colour a channel row shows for its current dye, so a custom colour set displays its derived shade. */
export function shownChannelDye(set: Dye | undefined, pick: Dye | undefined, channel: 0 | 2): Dye | undefined {
  if (pick !== undefined) return pick;
  return typeof set === 'string' && channel === 2 ? customShade(set) : set;
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

type Rgb = [number, number, number];

/** [red, green, blue, alpha] of a colour-mask pixel, 0..1. */
export type MaskPixel = [number, number, number, number];

const toGamma = (c: number) => {
  const v = Math.min(Math.max(c, 0), 1);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * CPU version of the tint shader for one pixel; the game's character shaders (`MS2CharacterMaterial`, `...Hair...`,
 * `...Skin...`) do exactly this, in gamma space:
 *
 *   tint   = R * OverrideColor0 + G * OverrideColor1 + (1 - R) * OverrideColor2
 *   albedo = lerp(base, tint, mask.alpha)
 *
 * The mask's alpha is the tinted region, R grades between the main colour (ch0) and the shade colour (ch2) and G adds
 * the accent colour (ch1); blue is not read. `base` and `t0..t2` are linear colours (a material colour factor is
 * expected to be applied to both already), the result is linear too.
 */
export function tintPixel(base: Rgb, mask: MaskPixel, t0: Rgb, t1: Rgb, t2: Rgb): Rgb {
  const [r, g, , a] = mask;
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tint = r * toGamma(t0[i]) + g * toGamma(t1[i]) + (1 - r) * toGamma(t2[i]);
    const b = toGamma(base[i]);
    out[i] = toLinear(b + (tint - b) * a);
  }
  return out;
}

/** What a tinted material was built from; the exporter uses it to bake the tint into a texture. */
export interface TintInfo {
  mask: Texture;
  enabled: boolean;
  colors: () => TintColors;
}
const tintInfo = new WeakMap<Material, TintInfo>();
export const getTintInfo = (material: Material) => tintInfo.get(material);
const maskUniforms = new WeakMap<Material, { value: Texture }>();

/** Update both the live shader and the texture mask used by GLB export. */
export function setTintMask(material: Material, mask: Texture, enabled = true) {
  const info = tintInfo.get(material);
  const uniform = maskUniforms.get(material);
  if (info && uniform) {
    info.mask = mask;
    info.enabled = enabled;
    uniform.value = mask;
  }
}

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

export function loadMask(url: string): Promise<Texture> {
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

/** Same maths as `tintPixel`; the colours are converted to gamma space and back like the game does everything in it. */
const COMMON_PATCH = /* glsl */ `
#include <common>
uniform sampler2D tintMask;
uniform vec3 tint0;
uniform vec3 tint1;
uniform vec3 tint2;
vec3 tintToGamma(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
vec3 tintToLinear(vec3 c) {
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
}
`;

const FRAGMENT_PATCH = /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
{
  vec4 m = texture2D(tintMask, vMapUv);
  vec3 tintGamma = m.r * tintToGamma(tint0) + m.g * tintToGamma(tint1) + (1.0 - m.r) * tintToGamma(tint2);
  vec3 tinted = tintToGamma(tintToLinear(tintGamma) * diffuse);
  diffuseColor.rgb = tintToLinear(mix(tintToGamma(diffuseColor.rgb), tinted, m.a));
}
#endif
`;

interface UniformSet {
  tint0: { value: Color };
  tint1: { value: Color };
  tint2: { value: Color };
}

const uniformsFor = (colors: TintColors): UniformSet => ({
  tint0: { value: colors.c0.clone() },
  tint1: { value: colors.c1.clone() },
  tint2: { value: colors.c2.clone() }
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
      const maskUniform = { value: mask };
      maskUniforms.set(material, maskUniform);
      material.userData = { ...original.userData };
      material.customProgramCacheKey = () => 'ms2-tint';
      material.onBeforeCompile = (shader) => {
        shader.uniforms.tintMask = maskUniform;
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', COMMON_PATCH)
          .replace('#include <map_fragment>', FRAGMENT_PATCH);
      };
      tintInfo.set(material, {
        mask,
        enabled: true,
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
