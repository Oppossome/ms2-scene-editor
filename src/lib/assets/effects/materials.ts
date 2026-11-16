import {
  AddEquation,
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  DstAlphaFactor,
  DstColorFactor,
  FrontSide,
  Matrix3,
  OneFactor,
  OneMinusDstAlphaFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SrcAlphaFactor,
  SrcAlphaSaturateFactor,
  SrcColorFactor,
  TextureLoader,
  UniformsLib,
  UniformsUtils,
  ZeroFactor,
  type BlendingDstFactor,
  type BlendingSrcFactor,
  type Material,
  type Texture
} from 'three';
import type { RenderState } from './types.js';

/** Gamebryo blend factor names (as the converter writes them) -> three.js factors. */
const FACTORS: Record<string, BlendingSrcFactor> = {
  one: OneFactor,
  zero: ZeroFactor,
  srcColor: SrcColorFactor,
  oneMinusSrcColor: OneMinusSrcColorFactor,
  dstColor: DstColorFactor,
  oneMinusDstColor: OneMinusDstColorFactor,
  srcAlpha: SrcAlphaFactor,
  oneMinusSrcAlpha: OneMinusSrcAlphaFactor,
  dstAlpha: DstAlphaFactor,
  oneMinusDstAlpha: OneMinusDstAlphaFactor,
  srcAlphaSaturate: SrcAlphaSaturateFactor
};

/** Whether a material state blends additively (src * a + dst), the usual glow. */
export function isAdditive(state: RenderState | undefined): boolean {
  return state?.blend?.dst === 'one';
}

/** Apply a Gamebryo render state (blending, depth, sides, alpha test) to any three.js material. */
export function applyRenderState(material: Material, state: RenderState) {
  if (state.blend) {
    material.transparent = true;
    material.blending = CustomBlending;
    material.blendEquation = AddEquation;
    material.blendSrc = FACTORS[state.blend.src] ?? SrcAlphaFactor;
    material.blendDst = (FACTORS[state.blend.dst] ?? OneMinusSrcAlphaFactor) as BlendingDstFactor;
    // The canvas is transparent over the backdrop, so its alpha decides how much backdrop shows. Additive and
    // multiplying blends only change colour (they keep the alpha already there); alpha blending covers like
    // three.js's NormalBlending does.
    const keepsAlpha = state.blend.dst === 'one' || state.blend.src === 'zero' || state.blend.src === 'dstColor';
    material.blendSrcAlpha = keepsAlpha ? ZeroFactor : OneFactor;
    material.blendDstAlpha = keepsAlpha ? OneFactor : OneMinusSrcAlphaFactor;
  }
  if (state.depthTest !== undefined) material.depthTest = state.depthTest;
  if (state.depthWrite !== undefined) material.depthWrite = state.depthWrite;
  else if (state.blend) material.depthWrite = false;
  material.side = state.side === 'front' ? FrontSide : state.side === 'back' ? BackSide : DoubleSide;
  // "Pass when alpha > ref" is three.js's alphaTest; a test against 0 still drops fully clear pixels.
  if (state.alphaTest && ['greater', 'greaterEqual'].includes(state.alphaTest.func))
    material.alphaTest = Math.max(state.alphaTest.ref, 1 / 255);
}

/** Gamebryo colours are gamma-space values; three.js works in linear. */
export function gammaColor(rgb: readonly number[] | undefined, fallback = 0): Color {
  return new Color().setRGB(rgb?.[0] ?? fallback, rgb?.[1] ?? fallback, rgb?.[2] ?? fallback, SRGBColorSpace);
}

/** Rough share of the fixed-function lights the studio has (it does not light effects): diffuse and ambient. */
export const DIFFUSE_LIGHT = 0.8;
export const AMBIENT_LIGHT = 0.3;

/** Texture slots an effect material samples, by Gamebryo slot number. */
export const SLOTS = { base: 0, detail: 2, glow: 4 } as const;
type SlotName = keyof typeof SLOTS;

/** A texture transform: Gamebryo's translation, scale, rotation (radians) about a centre. */
export interface UvTransform {
  translation: [number, number];
  scale: [number, number];
  rotation: number;
  center: [number, number];
}

const identityUv = (): UvTransform => ({ translation: [0, 0], scale: [1, 1], rotation: 0, center: [0.5, 0.5] });

const vertexShader = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
uniform mat3 baseUv;
uniform mat3 glowUv;
uniform mat3 detailUv;
varying vec2 vBaseUv;
varying vec2 vGlowUv;
varying vec2 vDetailUv;
void main() {
  vec3 tuv = vec3(uv, 1.0);
  vBaseUv = (baseUv * tuv).xy;
  vGlowUv = (glowUv * tuv).xy;
  vDetailUv = (detailUv * tuv).xy;
  #include <color_vertex>
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
uniform vec3 litColor;
uniform vec3 emissive;
uniform float vertexLight;
uniform float colorBoost;
uniform float opacity;
uniform float alphaCut;
#ifdef USE_BASE
uniform sampler2D baseMap;
#endif
#ifdef USE_GLOW
uniform sampler2D glowMap;
#endif
#ifdef USE_DETAIL
uniform sampler2D detailMap;
#endif
varying vec2 vBaseUv;
varying vec2 vGlowUv;
varying vec2 vDetailUv;
void main() {
  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>
  vec4 base = vec4(1.0);
  #ifdef USE_BASE
  base = texture2D(baseMap, vBaseUv);
  #endif
  vec3 lit = litColor;
  vec3 emi = emissive;
  float vertexAlpha = 1.0;
  #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )
  #ifdef USE_COLOR_ALPHA
  vec3 vertexRgb = vColor.rgb;
  vertexAlpha = vColor.a;
  #else
  vec3 vertexRgb = vColor;
  #endif
  // Vertex colours stand in for the emissive or the ambient and diffuse colours (NiVertexColorProperty).
  #if defined( VC_EMISSIVE )
  emi = vertexRgb * colorBoost;
  #elif defined( VC_AMBIENT_DIFFUSE )
  lit = vertexRgb * vertexLight;
  #endif
  #endif
  vec3 rgb = base.rgb * (lit + emi);
  #ifdef USE_GLOW
  // A glow map is self-illumination added as it is: effects with black material colours still show it (fire).
  rgb += texture2D(glowMap, vGlowUv).rgb;
  #endif
  #ifdef USE_DETAIL
  rgb *= texture2D(detailMap, vDetailUv).rgb * 2.0;
  #endif
  float alpha = base.a * opacity * vertexAlpha;
  if (alpha <= alphaCut) discard;
  gl_FragColor = vec4(rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The fixed-function look of a Gamebryo effect mesh, unlit (the studio has no game lights): the base map takes the
 * material's diffuse and ambient colours at a nominal light level, plus the emissive colour; a glow map adds its colour
 * as self-illumination. Detail maps modulate by 2x like the game. Each texture slot has its own UV transform, so
 * scrolling and flip-book controllers can drive it.
 */
export class EffectMaterial extends ShaderMaterial {
  readonly isEffectMaterial = true;
  readonly state: RenderState;
  private readonly uvs: Record<SlotName, UvTransform> = {
    base: identityUv(),
    detail: identityUv(),
    glow: identityUv()
  };
  private readonly baseUvs: Record<SlotName, UvTransform>;
  /** Unclamped Gamebryo colours, gamma space. */
  readonly colors: { ambient: number[]; diffuse: number[]; emissive: number[] };
  private colorBoost: number;

  constructor(
    state: RenderState,
    maps: Partial<Record<SlotName, Texture | null>>,
    options: { vertexColors?: boolean; uvTransforms?: Record<string, unknown> } = {}
  ) {
    super({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          litColor: { value: new Color() },
          emissive: { value: new Color() },
          vertexLight: { value: 1 },
          colorBoost: { value: 1 },
          opacity: { value: 1 },
          alphaCut: { value: 0 },
          baseMap: { value: null },
          glowMap: { value: null },
          detailMap: { value: null },
          baseUv: { value: new Matrix3() },
          glowUv: { value: new Matrix3() },
          detailUv: { value: new Matrix3() }
        }
      ]),
      vertexShader,
      fragmentShader,
      fog: true,
      vertexColors: !!options.vertexColors
    });
    this.state = state;
    this.colorBoost = state.colorBoost ?? 1;
    this.colors = {
      ambient: [...(state.ambient ?? [0, 0, 0])],
      diffuse: [...(state.diffuse ?? [1, 1, 1])],
      emissive: [...(state.emissive ?? [0, 0, 0])]
    };
    // Without a vertex colour property, vertex colours (rare in effects) tint like ambient and diffuse.
    const vertexMode = state.vertexColors ?? 'ambientDiffuse';
    if (vertexMode === 'emissive') this.defines.VC_EMISSIVE = '';
    else if (vertexMode === 'ambientDiffuse') this.defines.VC_AMBIENT_DIFFUSE = '';
    applyRenderState(this, state);
    // Additive glow should not be squashed by tone mapping (it is meant to blow out).
    this.toneMapped = !isAdditive(state);
    this.uniforms.alphaCut.value = this.alphaTest;
    this.alphaTest = 0;
    this.uniforms.opacity.value = state.alpha ?? 1;
    for (const slot of Object.keys(SLOTS) as SlotName[]) this.setMap(slot, maps[slot] ?? null);
    for (const [slot, t] of Object.entries(options.uvTransforms ?? {})) {
      const name = slot as SlotName;
      if (!(name in this.uvs)) continue;
      const tr = t as Partial<UvTransform>;
      this.uvs[name] = {
        translation: [...(tr.translation ?? [0, 0])] as [number, number],
        scale: [...(tr.scale ?? [1, 1])] as [number, number],
        rotation: tr.rotation ?? 0,
        center: [...(tr.center ?? [0.5, 0.5])] as [number, number]
      };
    }
    this.baseUvs = structuredClone(this.uvs);
    for (const slot of Object.keys(SLOTS) as SlotName[]) this.updateUv(slot);
    this.updateColors();
  }

  get opacityValue(): number {
    return this.uniforms.opacity.value;
  }
  set opacityValue(value: number) {
    this.uniforms.opacity.value = value;
  }

  setMap(slot: SlotName, texture: Texture | null) {
    this.uniforms[`${slot}Map`].value = texture;
    const define = `USE_${slot.toUpperCase()}`;
    const had = define in this.defines;
    if (texture) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      this.defines[define] = '';
    } else delete this.defines[define];
    if (had !== !!texture) this.needsUpdate = true;
  }

  getMap(slot: SlotName): Texture | null {
    return this.uniforms[`${slot}Map`].value;
  }

  /** Set one member of a slot's UV transform (NiTextureTransformController operation). */
  setUvMember(slot: SlotName, op: number, value: number) {
    const uv = this.uvs[slot];
    switch (op) {
      case 0:
        uv.translation[0] = value;
        break;
      case 1:
        uv.translation[1] = value;
        break;
      case 2:
        uv.rotation = value;
        break;
      case 3:
        uv.scale[0] = value;
        break;
      case 4:
        uv.scale[1] = value;
        break;
    }
    this.updateUv(slot);
  }

  /** Back to the authored UV transforms (before controllers). */
  resetUvs() {
    for (const slot of Object.keys(SLOTS) as SlotName[]) {
      this.uvs[slot] = structuredClone(this.baseUvs[slot]);
      this.updateUv(slot);
    }
  }

  private updateUv(slot: SlotName) {
    const { translation, scale, rotation, center } = this.uvs[slot];
    // uv' = R * S * (uv - centre) + centre - translation (the texture moves by +translation, as in 3ds Max).
    (this.uniforms[`${slot}Uv`].value as Matrix3).setUvTransform(
      -translation[0],
      -translation[1],
      scale[0],
      scale[1],
      rotation,
      center[0],
      center[1]
    );
  }

  setColor(which: 'ambient' | 'diffuse' | 'specular' | 'emissive', rgb: readonly number[]) {
    if (which === 'specular') return;
    this.colors[which] = [...rgb];
    this.updateColors();
  }

  setColorBoost(boost: number) {
    this.colorBoost = boost;
    this.updateColors();
  }

  private updateColors() {
    const { ambient, diffuse, emissive } = this.colors;
    const lighting = this.state.lighting === 'emissive' ? 0 : 1;
    const lit = [0, 1, 2].map(
      (c) => (diffuse[c] * DIFFUSE_LIGHT + ambient[c] * AMBIENT_LIGHT) * this.colorBoost * lighting
    );
    this.uniforms.vertexLight.value = (DIFFUSE_LIGHT + AMBIENT_LIGHT) * this.colorBoost * lighting;
    this.uniforms.colorBoost.value = this.colorBoost;
    (this.uniforms.litColor.value as Color).copy(gammaColor(lit));
    (this.uniforms.emissive.value as Color).copy(gammaColor(emissive.map((v) => v * this.colorBoost)));
  }
}

const textureLoader = new TextureLoader();
const textureCache = new Map<string, Promise<Texture>>();

/** Load a colour texture the way glTF textures are (no flip, sRGB, repeating), cached by URL. */
export function loadEffectTexture(url: string): Promise<Texture> {
  let hit = textureCache.get(url);
  if (!hit) {
    hit = textureLoader.loadAsync(url).then((texture) => {
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      return texture;
    });
    hit.catch(() => textureCache.delete(url));
    textureCache.set(url, hit);
  }
  return hit;
}
