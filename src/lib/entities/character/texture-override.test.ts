import { describe, expect, it, vi } from 'vitest';
import { Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, Texture, TextureLoader } from 'three';
import { applyTint, getTintInfo } from './tint.js';
import { applyTextureOverrides, listItemTextures, resetTextureOverrides, textureKey } from './texture-override.js';

function map(uri: string) {
  const texture = new Texture();
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.channel = 0;
  texture.userData = { uri, url: `/api/assets/converted/textures/${uri.split('/').pop()}` };
  return texture;
}

/** An item model: two meshes sharing the shirt material, plus a skin part masked with the body mask. */
function item() {
  const shirt = new MeshStandardMaterial({ map: map('../../textures/item_clothes/01400009_M_UGC01_d.png') });
  const skin = new MeshStandardMaterial({ map: map('../../textures/item_body/m_body_d.png') });
  skin.userData = { ms2: { shader0: '../../textures/item_body/m_body_c.png' } };
  const front = new Mesh(undefined, shirt);
  const back = new Mesh(undefined, shirt);
  const skinPart = new Mesh(undefined, skin);
  const root = new Group().add(front, back, skinPart);
  return { root, front, back, skinPart, shirt, skin };
}

describe('textureKey', () => {
  it('is the lower-case file name', () => {
    expect(textureKey('../../a/B%20C_d.PNG')).toBe('b c_d.png');
    expect(textureKey('x\\y\\Z.png')).toBe('z.png');
  });
});

describe('texture overrides', () => {
  it("lists the item's own colour maps once each, without its skin parts", () => {
    const { root } = item();
    expect(listItemTextures([root])).toEqual([
      { key: '01400009_m_ugc01_d.png', url: '/api/assets/converted/textures/01400009_M_UGC01_d.png' }
    ]);
  });

  it('shows an image on copies of the material, keeping the sampling settings, and restores the original', () => {
    const { root, front, back, skinPart, shirt, skin } = item();
    const image = new Texture();
    applyTextureOverrides([root], new Map([['01400009_m_ugc01_d.png', image]]));
    const copy = front.material as MeshStandardMaterial;
    expect(copy).not.toBe(shirt);
    expect(back.material).toBe(copy);
    expect(shirt.map?.userData.uri).toMatch(/UGC01_d/);
    expect(copy.map?.source).toBe(image.source);
    expect(copy.map?.flipY).toBe(false);
    expect(copy.map?.colorSpace).toBe(SRGBColorSpace);
    expect(skinPart.material).toBe(skin);
    // Still listed under its own name while overridden.
    expect(listItemTextures([root]).map((t) => t.key)).toEqual(['01400009_m_ugc01_d.png']);

    applyTextureOverrides([root], new Map([['01400009_m_ugc01_d.png', image]]));
    expect(front.material).toBe(copy);

    let disposed = 0;
    copy.addEventListener('dispose', () => disposed++);
    resetTextureOverrides([root]);
    expect(front.material).toBe(shirt);
    expect(back.material).toBe(shirt);
    expect(disposed).toBe(1);
  });

  it('swaps one image for another and ignores keys the item does not have', () => {
    const { root, front, shirt } = item();
    applyTextureOverrides([root], new Map([['01400009_m_ugc01_d.png', new Texture()]]));
    const first = front.material;
    const second = new Texture();
    applyTextureOverrides(
      [root],
      new Map([
        ['01400009_m_ugc01_d.png', second],
        ['other.png', new Texture()]
      ])
    );
    expect(front.material).not.toBe(first);
    expect((front.material as MeshStandardMaterial).map?.source).toBe(second.source);
    applyTextureOverrides([root], new Map([['m_body_d.png', new Texture()]]));
    expect(front.material).toBe(shirt);
  });
});

describe('texture overrides on tinted items', () => {
  it('shows the image without the tint and gives the tinted material back on reset', async () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture());
    try {
      const { root, front, shirt } = item();
      shirt.userData = { ms2: { shader0: '../../textures/item_clothes/01400009_m_ugc01_c.png' } };
      const colors = { c0: new Color('red'), c1: new Color('green'), c2: new Color('blue') };
      await applyTint(root, 'Item/0/14/01400009_m_ugc01.glb', colors);
      const tinted = front.material as MeshStandardMaterial;
      expect(getTintInfo(tinted)).toBeDefined();

      applyTextureOverrides([root], new Map([['01400009_m_ugc01_d.png', new Texture()]]));
      expect(front.material).not.toBe(tinted);
      expect(getTintInfo(front.material as MeshStandardMaterial)).toBeUndefined();

      resetTextureOverrides([root]);
      expect(front.material).toBe(tinted);
    } finally {
      loader.mockRestore();
    }
  });
});
