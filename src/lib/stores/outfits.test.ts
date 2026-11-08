import { describe, expect, it } from 'vitest';
import {
  deleteNamed,
  loadCurrent,
  loadSaved,
  parseSnapshot,
  parseSnapshotJson,
  saveCurrent,
  saveNamed,
  type OutfitSnapshot
} from './outfits';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const snap: OutfitSnapshot = { version: 1, gender: 1, skin: 3, items: [{ id: '11400604', color: 2 }, { id: '10200001' }] };

describe('parseSnapshot', () => {
  it('accepts a valid snapshot', () => {
    expect(parseSnapshot(snap)).toEqual(snap);
  });

  it('rejects wrong versions, genders and malformed items', () => {
    expect(parseSnapshot({ ...snap, version: 2 })).toBeNull();
    expect(parseSnapshot({ ...snap, gender: 2 })).toBeNull();
    expect(parseSnapshot({ ...snap, items: [{ id: 'abc' }] })).toBeNull();
    expect(parseSnapshot({ ...snap, items: 'x' })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshotJson('{not json')).toBeNull();
  });

  it('drops invalid colours and falls back for a bad skin index', () => {
    const parsed = parseSnapshot({ version: 1, gender: 0, skin: -4, items: [{ id: '1', color: -1 }] });
    expect(parsed).toEqual({ version: 1, gender: 0, skin: 0, items: [{ id: '1' }] });
  });
});

describe('storage helpers', () => {
  it('round-trips the current outfit', () => {
    const s = new MemoryStorage();
    expect(loadCurrent(s)).toBeNull();
    saveCurrent(s, snap);
    expect(loadCurrent(s)).toEqual(snap);
  });

  it('saves, lists and deletes named outfits, ignoring corrupt entries', () => {
    const s = new MemoryStorage();
    saveNamed(s, 'beach', snap);
    saveNamed(s, 'winter', { ...snap, gender: 0 });
    expect(Object.keys(loadSaved(s))).toEqual(['beach', 'winter']);
    deleteNamed(s, 'beach');
    expect(Object.keys(loadSaved(s))).toEqual(['winter']);
    s.setItem('bs2.outfit.saved', '{"bad": {"version": 9}, "ok": ' + JSON.stringify(snap) + '}');
    expect(Object.keys(loadSaved(s))).toEqual(['ok']);
  });
});
