import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { durationFromGltfJson, listClips, readGlbJson } from './clips';

/** A minimal binary glTF holding just a JSON chunk. */
function glb(json: object): Buffer {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const body = Buffer.from(text);
  const out = Buffer.alloc(20 + body.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(body.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  body.copy(out, 20);
  return out;
}

const clip = (end: number) => ({
  accessors: [{ max: [0] }, { max: [end] }, { max: [end / 2] }],
  animations: [{ samplers: [{ input: 0 }, { input: 1 }, { input: 2 }] }]
});

describe('durationFromGltfJson', () => {
  it('is the latest keyframe time over all samplers', () => {
    expect(durationFromGltfJson(clip(2.1333334))).toBe(2.133);
  });

  it('takes the longest of several animations', () => {
    const json = {
      accessors: [{ max: [1] }, { max: [3.5] }],
      animations: [{ samplers: [{ input: 0 }] }, { samplers: [{ input: 1 }] }]
    };
    expect(durationFromGltfJson(json)).toBe(3.5);
  });

  it('is 0 without animations, samplers or usable accessors', () => {
    expect(durationFromGltfJson({})).toBe(0);
    expect(durationFromGltfJson({ animations: [{}] })).toBe(0);
    expect(
      durationFromGltfJson({
        accessors: [{}, { max: ['x' as never] }],
        animations: [{ samplers: [{ input: 0 }, { input: 1 }, { input: 9 }, {}] }]
      })
    ).toBe(0);
  });
});

describe('clip files', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the JSON chunk of a GLB and rejects other files', () => {
    fs.writeFileSync(path.join(dir, 'a.glb'), glb(clip(1)));
    fs.writeFileSync(path.join(dir, 'bad.glb'), 'not a glb at all, just text that is long enough');
    fs.writeFileSync(path.join(dir, 'short.glb'), 'xx');
    expect(readGlbJson(path.join(dir, 'a.glb'))).toMatchObject({ animations: [{}] });
    expect(readGlbJson(path.join(dir, 'bad.glb'))).toBeNull();
    expect(readGlbJson(path.join(dir, 'short.glb'))).toBeNull();
    expect(readGlbJson(path.join(dir, 'missing.glb'))).toBeNull();
  });

  it('lists clips sorted by name with durations, ignoring other files', () => {
    fs.writeFileSync(path.join(dir, 'walk_a.GLB'), glb(clip(0.8)));
    fs.writeFileSync(path.join(dir, 'idle_a.glb'), glb(clip(2)));
    fs.writeFileSync(path.join(dir, 'broken.glb'), 'junk');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    expect(listClips(dir)).toEqual([
      { name: 'broken', duration: 0 },
      { name: 'idle_a', duration: 2 },
      { name: 'walk_a', duration: 0.8 }
    ]);
  });

  it('writes a cache file that a fresh process trusts while the folder is unchanged', async () => {
    fs.writeFileSync(path.join(dir, 'a.glb'), glb(clip(1)));
    const cacheFile = path.join(dir, '..', `${path.basename(dir)}-cache`, 'clips.json');
    try {
      expect(listClips(dir, cacheFile)).toEqual([{ name: 'a', duration: 1 }]);
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      expect(saved.clips).toEqual([{ name: 'a', duration: 1 }]);

      // A new process has no memo: it reads the cache instead of scanning (the planted value proves it).
      vi.resetModules();
      const fresh = await import('./clips');
      fs.writeFileSync(cacheFile, JSON.stringify({ mtimeMs: saved.mtimeMs, clips: [{ name: 'cached', duration: 9 }] }));
      expect(fresh.listClips(dir, cacheFile)).toEqual([{ name: 'cached', duration: 9 }]);

      // A changed folder invalidates the cache.
      vi.resetModules();
      const again = await import('./clips');
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(dir, later, later);
      expect(again.listClips(dir, cacheFile)).toEqual([{ name: 'a', duration: 1 }]);
    } finally {
      fs.rmSync(path.dirname(cacheFile), { recursive: true, force: true });
    }
  });

  it('is null for a missing folder and refreshes when the folder changes', () => {
    expect(listClips(path.join(dir, 'nope'))).toBeNull();
    fs.writeFileSync(path.join(dir, 'a.glb'), glb(clip(1)));
    expect(listClips(dir)).toHaveLength(1);
    expect(listClips(dir)).toBe(listClips(dir));
    fs.writeFileSync(path.join(dir, 'b.glb'), glb(clip(1)));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(dir, later, later);
    expect(listClips(dir)).toHaveLength(2);
  });
});
