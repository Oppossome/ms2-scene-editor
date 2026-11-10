import { describe, expect, it, vi } from 'vitest';
import { Color, Mesh, MeshStandardMaterial, Texture, TextureLoader } from 'three';
import {
  isSkinMask,
  applyTint,
  getTintInfo,
  setTintMask,
  parseChannelIndexes,
  tintFromPalette,
  tintPixel
} from './tint';
import type { PaletteColor } from '../../types';

const white: [number, number, number] = [1, 1, 1];
const grey: [number, number, number] = [0.3, 0.3, 0.3];
const red: [number, number, number] = [0.8, 0.1, 0.1];
const green: [number, number, number] = [0.1, 0.8, 0.1];
const blue: [number, number, number] = [0.1, 0.1, 0.8];

it('updates the face mask without losing live eye colours', async () => {
  const mask = new Texture<HTMLImageElement>();
  const loader = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(mask);
  try {
    const material = new MeshStandardMaterial({ map: new Texture() });
    material.userData = { ms2: { shader0: 'dynamic_face_mask.png' } };
    const mesh = new Mesh(undefined, material);
    const colors = { c0: new Color('red'), c1: new Color('green'), c2: new Color('blue') };
    const tint = await applyTint(mesh, 'Character/male/m_body.glb', colors);
    const replacement = new Texture();
    setTintMask(mesh.material, replacement);
    expect(getTintInfo(mesh.material)?.mask).toBe(replacement);
    setTintMask(mesh.material, replacement, false);
    setTintMask(mesh.material, replacement);
    expect(getTintInfo(mesh.material)?.enabled).toBe(true);
    tint?.setColors({ ...colors, c0: new Color('yellow') });
    expect(getTintInfo(mesh.material)?.colors().c0.getHexString()).toBe('ffff00');
    expect(getTintInfo(mesh.material)?.mask).toBe(replacement);
  } finally {
    loader.mockRestore();
  }
});

describe('isSkinMask', () => {
  it('recognises the body masks used by the skin parts of clothes', () => {
    expect(isSkinMask('../../../../textures/Resource/Model/Textures/item_body/m_body_c.png')).toBe(true);
    expect(isSkinMask('../../../../textures/Resource/Model/Textures/item_body/f_skin_body_c.png')).toBe(true);
    expect(isSkinMask('../../../textures/Resource/Model/Character/male/m_body_c.png')).toBe(true);
    expect(isSkinMask('..\\textures\\F_SKIN_BODY_C.PNG')).toBe(true);
    expect(isSkinMask('a/m%5Fbody_c.png')).toBe(true);
  });

  it('does not match an item\'s own mask', () => {
    expect(isSkinMask('../../textures/item/11700001_c_studentsrunningshoes_c.png')).toBe(false);
    expect(isSkinMask('../00200026_f_shortbodyperm_c.png')).toBe(false);
    expect(isSkinMask('m_body_c.png.bak')).toBe(false);
    expect(isSkinMask('')).toBe(false);
  });
});

const gamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// The game's shader: tint = R*C0 + G*C1 + (1-R)*C2 and albedo = lerp(base, tint, alpha), in gamma space.
describe('tintPixel', () => {
  it('leaves pixels with no mask alpha alone, whatever the mask colour', () => {
    const out = tintPixel(grey, [1, 1, 0, 0], red, green, blue);
    out.forEach((v, i) => expect(v).toBeCloseTo(grey[i], 5));
  });

  it('replaces the base with the tint where the alpha is 1 (the base hue does not show through)', () => {
    const base: [number, number, number] = [0.3, 0.02, 0.02];
    const out = tintPixel(base, [1, 0, 0, 1], blue, green, red);
    out.forEach((v, i) => expect(v).toBeCloseTo(blue[i], 5));
  });

  it('grades between the main colour (red channel 1) and the shade colour (red channel 0)', () => {
    const main = tintPixel(white, [1, 0, 0, 1], red, green, blue);
    const shade = tintPixel(white, [0, 0, 0, 1], red, green, blue);
    main.forEach((v, i) => expect(v).toBeCloseTo(red[i], 5));
    shade.forEach((v, i) => expect(v).toBeCloseTo(blue[i], 5));
    const mid = tintPixel(white, [0.5, 0, 0, 1], red, green, blue);
    expect(mid[0]).toBeCloseTo(linear(0.5 * gamma(red[0]) + 0.5 * gamma(blue[0])), 5);
  });

  it('adds the accent colour with the green channel', () => {
    const out = tintPixel(white, [0, 1, 0, 1], red, green, blue);
    // R = 0 puts the shade colour in as well: tint = G*C1 + C2 (not clamped before lighting, like the game)
    expect(out[1]).toBeCloseTo(linear(gamma(green[1]) + gamma(blue[1])), 5);
  });

  it('does not read the blue channel', () => {
    expect(tintPixel(grey, [0.4, 0.2, 0, 1], red, green, blue)).toEqual(tintPixel(grey, [0.4, 0.2, 1, 1], red, green, blue));
  });

  it('blends partial alpha between the base and the tint in gamma space', () => {
    const half = tintPixel(grey, [1, 0, 0, 0.5], red, green, blue);
    expect(half[0]).toBeCloseTo(linear(0.5 * gamma(grey[0]) + 0.5 * gamma(red[0])), 5);
  });
});

const row = (sn: number, ch0: string, ch1: string, ch2: string): PaletteColor => ({ sn, ch0, ch1, ch2, palette: ch0 });
const palette = [row(0, '0xffaa0000', '0xff00aa00', '0xff0000aa'), row(1, '0xffffffff', '0xff111111', '0xff222222'), row(2, '0xff010203', '0xff040506', '0xff070809')];
const hex = (c: Color) => c.getHexString();

describe('tintFromPalette', () => {
  it('takes all three channels from the base row', () => {
    const c = tintFromPalette(palette, 1)!;
    expect([hex(c.c0), hex(c.c1), hex(c.c2)]).toEqual(['ffffff', '111111', '222222']);
  });

  it('takes a picked channel from the picked row, using that row\'s colour for that channel', () => {
    const c = tintFromPalette(palette, 0, { ch0: 1, ch2: 2 })!;
    expect([hex(c.c0), hex(c.c1), hex(c.c2)]).toEqual(['ffffff', '00aa00', '070809']);
  });

  it('falls back for unknown rows: the base row, then row 0', () => {
    expect(hex(tintFromPalette(palette, 1, { ch0: 99 })!.c0)).toBe('ffffff');
    expect(hex(tintFromPalette(palette, 42)!.c0)).toBe('aa0000');
    expect(tintFromPalette([], 0)).toBeUndefined();
  });
});

describe('parseChannelIndexes', () => {
  it('keeps valid picks only', () => {
    expect(parseChannelIndexes({ ch0: 3, ch2: 0, ch1: -1, extra: 5 })).toEqual({ ch0: 3, ch2: 0 });
    expect(parseChannelIndexes({ ch0: 1.5, ch1: '2' })).toBeNull();
    expect(parseChannelIndexes({ ch1: 2 })).toBeNull();
    expect(parseChannelIndexes(null)).toBeNull();
    expect(parseChannelIndexes('x')).toBeNull();
    expect(parseChannelIndexes({})).toBeNull();
  });
});
