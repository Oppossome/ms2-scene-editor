import { Color, Mesh, MeshStandardMaterial, Texture, TextureLoader } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyTint, setTintMask } from '../entities/character/tint.js';
import { bakeTintedMaterial } from './bake.js';

describe('bakeTintedMaterial', () => {
  it('does not bake a face frame whose tint mask is disabled', async () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture<HTMLImageElement>());
    try {
      const material = new MeshStandardMaterial({ map: new Texture() });
      material.userData = { ms2: { shader0: 'dynamic_face_mask.png' } };
      const mesh = new Mesh(undefined, material);
      const colors = { c0: new Color('red'), c1: new Color('green'), c2: new Color('blue') };
      await applyTint(mesh, 'Character/male/m_body.glb', colors);
      setTintMask(mesh.material, new Texture(), false);
      const map = mesh.material.map;
      const readMap = vi.fn(() => map);
      Object.defineProperty(mesh.material, 'map', { get: readMap });
      expect(bakeTintedMaterial(mesh.material)).toBeNull();
      expect(readMap).not.toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });
});
