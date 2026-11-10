import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaceAnimations } from './expressions.js';

const { baseTextures, masks, maskUpdates } = vi.hoisted(() => ({
  baseTextures: new Map<string, Texture>(),
  masks: new Map<string, Texture>(),
  maskUpdates: vi.fn()
}));

vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return {
    ...actual,
    TextureLoader: class {
      async loadAsync(path: string) {
        let texture = baseTextures.get(path);
        if (!texture) {
          texture = new actual.Texture();
          baseTextures.set(path, texture);
        }
        return texture;
      }
    }
  };
});

vi.mock('./tint.js', async (original) => {
  const actual = await original<typeof import('./tint.js')>();
  return {
    ...actual,
    getTintInfo: (material: MeshStandardMaterial) => ({ mask: material.userData.originalMask }),
    setTintMask: maskUpdates,
    loadMask: async (url: string) => {
      let texture = masks.get(url);
      if (!texture) {
        texture = new Texture();
        masks.set(url, texture);
      }
      return texture;
    }
  };
});

const { FaceAnimator } = await import('./face-animation.js');

function model(skin = false) {
  const material = new MeshStandardMaterial();
  material.map = new Texture();
  material.userData = { originalMask: new Texture(), ms2: { shader0: skin ? 'm_body_c.png' : 'face_c.png' } };
  return { mesh: new Mesh(undefined, material), material, original: material.map };
}

afterEach(() => {
  vi.unstubAllGlobals();
  maskUpdates.mockClear();
});

describe('FaceAnimator', () => {
  it('follows clip time, overrides expressions, restores idle, and leaves head skin alone', async () => {
    const data: FaceAnimations = {
      sequences: { test: { frames: [
        { base: 'idle.png', mask: 'idle_c.png', duration: 100 },
        { base: 'blink.png', mask: 'blink_c.png', duration: 100 }
      ], loopStart: null } },
      overrides: { smile: { base: 'smile.png', mask: null, duration: null } }
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const face = model();
    const skin = model(true);
    const root = new Group();
    root.add(face.mesh, skin.mesh);
    const animator = new FaceAnimator(0);
    animator.setTargets([root]);
    animator.update('TEST', 0);
    await animator.ready();
    expect(face.material.map).toBe(baseTextures.get('/api/assets/idle.png'));
    animator.update('TEST', 0.15);
    expect(face.material.map).toBe(baseTextures.get('/api/assets/blink.png'));
    expect(maskUpdates).toHaveBeenLastCalledWith(face.material, masks.get('/api/assets/blink_c.png'), true);
    animator.update('TEST', 0);
    expect(face.material.map).toBe(baseTextures.get('/api/assets/idle.png'));

    animator.update('TEST', 0, 'smile');
    await animator.ready();
    expect(face.material.map).toBe(baseTextures.get('/api/assets/smile.png'));
    expect(maskUpdates.mock.lastCall?.[1].image.data[3]).toBe(0);
    expect(skin.material.map).toBe(skin.original);
    animator.dispose();
    expect(face.material.map).toBe(face.original);
    expect(maskUpdates).toHaveBeenLastCalledWith(face.material, face.material.userData.originalMask);
  });

  it('does not apply a late response to a replaced face', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const face = model();
    const animator = new FaceAnimator(1);
    animator.setTargets([face.mesh]);
    animator.update('test', 0);
    animator.setTargets([]);
    resolve(new Response(JSON.stringify({ sequences: { test: { frames: [{ base: 'late.png', mask: null, duration: null }], loopStart: null } }, overrides: {} })));
    await animator.ready();
    expect(face.material.map).toBe(face.original);
  });
});
