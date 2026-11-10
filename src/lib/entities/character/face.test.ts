import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain function, not vi.fn: the spy wrapper reports a rejection the code under test already handles.
let nextLoad: () => Promise<Texture> = async () => new Texture();
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return {
    ...actual,
    TextureLoader: class {
      loadAsync = () => nextLoad();
    }
  };
});

const { applyFaceTextures, faceTextureUrls } = await import('./face');

describe('faceTextureUrls', () => {
  it('points at the folder named after the item id without its leading 1', () => {
    const urls = faceTextureUrls('10300002')!;
    expect(urls.base).toBe('/api/assets/converted/textures/Resource/Model/Textures/item_face/00300002/01_idle.png');
    expect(urls.mask).toBe('/api/assets/converted/textures/Resource/Model/Textures/item_face/00300002/02_idle_c.png');
    expect(faceTextureUrls('10300156')!.base).toContain('/00300156/');
  });

  it('rejects ids that are not item ids', () => {
    for (const bad of ['', 'abc', '5', '-10300002', '1.5']) expect(faceTextureUrls(bad)).toBeNull();
  });
});

function faceModel(extra = false) {
  const original = new MeshStandardMaterial();
  original.map = new Texture();
  original.userData = { ms2: { shader0: 'old_c.png', gloss: 'g.png' } };
  const group = new Group();
  const a = new Mesh(undefined, original);
  const b = new Mesh(undefined, original);
  group.add(a, b);
  // the head skin that comes with the face, using the body's skin texture and mask
  const skin = new MeshStandardMaterial();
  skin.map = new Texture();
  skin.userData = { ms2: { shader0: '../../textures/Resource/Model/Character/female/f_skin_body_c.png' } };
  const head = new Mesh(undefined, skin);
  if (extra) group.add(head);
  return { group, a, b, original, head, skin };
}

describe('applyFaceTextures', () => {
  // Loaded textures are cached by url, so each test uses a face of its own.
  beforeEach(() => {
    nextLoad = async () => new Texture();
  });

  it('swaps the face and its mask on a copy, leaving the shared material alone', async () => {
    const tex = new Texture();
    nextLoad = async () => tex;
    const { group, a, b, original } = faceModel();
    const before = original.map;
    expect(await applyFaceTextures(group, '10300002')).toBe(true);
    const material = a.material as MeshStandardMaterial;
    expect(material).not.toBe(original);
    expect(material.map).toBe(tex);
    expect(material.userData.ms2).toEqual({
      shader0: expect.stringContaining('/00300002/02_idle_c.png'),
      gloss: 'g.png'
    });
    expect(original.map).toBe(before);
    expect(original.userData.ms2.shader0).toBe('old_c.png');
    // meshes that shared a material still share (one copy)
    expect(b.material).toBe(material);
  });

  it('leaves the head skin of the model on the body skin texture and mask', async () => {
    nextLoad = async () => new Texture();
    const { group, head, skin, a, original } = faceModel(true);
    await applyFaceTextures(group, '10300004');
    expect(head.material).toBe(skin);
    expect(skin.map).toBeInstanceOf(Texture);
    expect(a.material).not.toBe(original);
  });

  it('uses the face texture settings of the glTF loader', async () => {
    const tex = new Texture();
    nextLoad = async () => tex;
    const { group, original } = faceModel();
    original.map!.flipY = false;
    await applyFaceTextures(group, '10300003');
    expect(tex.flipY).toBe(false);
    expect(tex.colorSpace).toBe('srgb');
  });

  it('keeps the model as it is when the face has no textures', async () => {
    nextLoad = () => Promise.reject(new Error('404'));
    const { group, a, original } = faceModel();
    expect(await applyFaceTextures(group, '10300059')).toBe(false);
    expect(a.material).toBe(original);
    expect(await applyFaceTextures(group, 'nope')).toBe(false);
  });
});
