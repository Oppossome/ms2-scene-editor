import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeMap, expandLegacyMaps } from './entities';
import { parseScene } from '../scene/document';
import { GroupEntity } from '../entities/group.svelte.js';
import { SceneState } from '../scene/store.svelte.js';
import { loadJson } from '../scene/testing';
import type { MapData } from '../types';

const source: MapData = {
  id: '1',
  name: 'Test map',
  models: ['Map/a.glb'],
  items: [[0, 10, 20, 30, 0, 0, 0, 1, 1, 1]],
  total: 3,
  unresolved: 2,
  environment: { background: 'Resource/Image/bg/test.png', fog: { color: [1, 2, 3], near: 10, far: 100 } }
};
const legacy = {
  id: 'map',
  kind: 'map',
  mapId: '1',
  name: 'Map',
  parentId: null,
  position: [1, 2, 3],
  rotation: [0, 1, 0],
  scale: [2, 2, 2],
  visible: false,
  locked: true
};
afterEach(() => vi.unstubAllGlobals());

describe('map documents and persistence', () => {
  it('saves the actual edited children and never regenerates them from the map', () => {
    const store = new SceneState();
    const root = new GroupEntity({ id: 'map' });
    root.set({ name: 'Map', mapId: '1' });
    store.append([root, ...composeMap(root, source)]);
    const prop = store.nodes.find((node) => node.type === 'prop')!;
    store.update(prop.id, { position: [8, 9, 10], name: 'Edited prop' });
    const saved = store.serialize();
    const loaded = new SceneState();
    expect(loadJson(loaded, saved)).toBe(true);
    expect(loaded.serialize()).toEqual(saved);
    loaded.remove(prop.id);
    expect(parseScene(JSON.parse(loaded.serialize()))!.entities.map((node) => node.type)).toEqual([
      'group',
      'lighting'
    ]);
  });

  it('converts old map nodes atomically, keeping ids, transforms, mounts, existing children and order', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(source)));
    vi.stubGlobal('fetch', fetch);
    const doc = parseScene({
      version: 1,
      nodes: [
        { ...legacy, parentId: 'hero', attachBone: 'Head' },
        { ...legacy, id: 'existing', kind: 'group', parentId: 'map', mapId: undefined },
        {
          id: 'hero',
          kind: 'character',
          gender: 1,
          name: 'Hero',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      ]
    })!;
    const entities = await expandLegacyMaps(doc);
    expect(entities[0]).toMatchObject({
      id: 'map',
      type: 'group',
      mapId: '1',
      parentId: 'hero',
      attachBone: 'Head',
      visible: false,
      locked: true
    });
    expect(entities[0].position).toEqual([1, 2, 3]);
    expect(entities[1].id).toBe('existing');
    expect(entities.slice(0, 3).map((node) => node.id)).toEqual(['map', 'existing', 'hero']);
    expect(entities.slice(3).map((node) => [node.type, node.parentId])).toEqual([
      ['prop', 'map'],
      ['lighting', 'map']
    ]);
    expect(new Set(entities.map((node) => node.id)).size).toBe(entities.length);
    const store = new SceneState();
    store.load(entities);
    const ids = store.nodes.map((node) => node.id);
    store.undo();
    store.redo();
    expect(store.nodes.map((node) => node.id)).toEqual(ids);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects missing data and cancellation, leaving the document unchanged', async () => {
    const doc = parseScene({ version: 1, nodes: [legacy] })!;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    await expect(expandLegacyMaps(doc)).rejects.toThrow('HTTP 404');
    const controller = new AbortController();
    controller.abort();
    await expect(expandLegacyMaps(doc, controller.signal)).rejects.toThrow();
    expect(doc.entities).toHaveLength(1);
  });

  it('rejects map data that points at a missing model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...source, items: [[5, 0, 0, 0, 0, 0, 0, 1, 1, 1]] })))
    );
    await expect(expandLegacyMaps(parseScene({ version: 1, nodes: [legacy] })!)).rejects.toThrow(/model index/);
  });
});
