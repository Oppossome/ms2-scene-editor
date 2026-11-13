import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { tagTextureUris } from './loader.js';

describe('tagTextureUris', () => {
  it('records the image each colour map was loaded from, resolved against the model', () => {
    const shirt = new Texture();
    const untracked = new Texture();
    const scene = new Group().add(
      new Mesh(undefined, new MeshStandardMaterial({ map: shirt })),
      new Mesh(undefined, new MeshStandardMaterial({ map: untracked })),
      new Mesh(undefined, new MeshStandardMaterial())
    );
    const parser = {
      json: { textures: [{ source: 1 }], images: [{ uri: 'a.png' }, { uri: '../../../../textures/item/shirt_d.png' }] },
      associations: new Map([[shirt, { textures: 0 }]])
    } as unknown as GLTF['parser'];
    tagTextureUris({ scene, parser }, '/api/assets/converted/models/Item/0/14/shirt.glb');
    expect(shirt.userData).toEqual({
      uri: '../../../../textures/item/shirt_d.png',
      url: '/api/assets/converted/textures/item/shirt_d.png'
    });
    expect(untracked.userData).toEqual({});
  });
});
