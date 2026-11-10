import { afterEach, describe, expect, it, vi } from 'vitest';
import { Studio } from './controller.svelte.js';
import { SCENE_KEY } from '../scene/model.js';

const map = {
  id: '1', name: 'Map', models: ['Map/a.glb'],
  items: [[0, 10, 20, 30, 0, 0, 0, 1, 1, 1]], total: 1, unresolved: 0
};
const legacy = JSON.stringify({ version: 1, nodes: [{
  id: 'map', kind: 'map', name: 'Map', mapId: '1', parentId: null,
  position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, locked: false
}] });
afterEach(() => vi.unstubAllGlobals());

describe('document loading', () => {
  it('converts an old autosave before committing, without recording an initial undo step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(map))));
    const studio = new Studio();
    const storage = new Map([[SCENE_KEY, legacy]]);
    try {
      expect(await studio.restoreLocal({ getItem: (key) => storage.get(key) ?? null })).toBe(true);
      expect(JSON.parse(studio.store.serialize()).version).toBe(3);
      expect(studio.store.nodes.map((node) => node.type)).toEqual(['group', 'prop', 'lighting']);
      expect(studio.store.canUndo).toBe(false);
      expect(studio.autosaveBlocked).toBe(false);
      expect(storage.get(SCENE_KEY)).toBe(legacy);
    } finally { studio.dispose(); }
  });
  it('preserves the original save on missing map data, and permits recovery through a valid import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Missing', { status: 404 })));
    const studio = new Studio();
    try {
      const before = studio.store.serialize();
      expect(await studio.restoreLocal({ getItem: () => legacy })).toBe(false);
      expect(studio.store.serialize()).toBe(before);
      expect(studio.autosaveBlocked).toBe(true);
      expect(studio.message).toMatch(/original save preserved.*404/);
      await studio.importJson(new File([JSON.stringify({ version: 3, entities: [] })], 'empty.json'));
      expect(studio.autosaveBlocked).toBe(false);
    } finally { studio.dispose(); }
  });
  it('cancels a pending map insertion when Undo is pressed, even with no existing history', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })));
    const studio = new Studio();
    try {
      const insertion = studio.addMap({ id: '1', name: 'Map' });
      studio.store.undo();
      resolve(new Response(JSON.stringify(map)));
      expect(await insertion).toBe('');
      expect(studio.store.nodes).toEqual([]);
      expect(studio.store.canUndo).toBe(false);
    } finally { studio.dispose(); }
  });
  it('inserts a whole map as a single undoable action, with stable IDs on redo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(map))));
    const studio = new Studio();
    try {
      const id = await studio.addMap({ id: '1', name: 'Map' });
      expect(studio.store.node(id)?.type).toBe('group');
      const data = studio.store.serialize();
      studio.store.undo();
      expect(studio.store.nodes).toHaveLength(0);
      studio.store.redo();
      expect(studio.store.serialize()).toBe(data);
    } finally { studio.dispose(); }
  });
  it('reports fatal JSON validation paths instead of replacing the current scene', async () => {
    const studio = new Studio();
    try {
      studio.addGroup();
      const before = studio.store.serialize();
      await studio.importJson(new File(['{"version":99,"nodes":[]}'], 'bad.json'));
      expect(studio.store.serialize()).toBe(before);
      expect(studio.message).toMatch(/Cannot load scene:.*version/);
    } finally { studio.dispose(); }
  });
});
