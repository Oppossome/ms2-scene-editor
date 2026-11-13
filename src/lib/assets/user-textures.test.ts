import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportUserTextures,
  getUserTexture,
  importUserTextures,
  memoryTextureStorage,
  putUserTexture,
  setTextureStorage,
  sha256Fallback,
  textureId,
  validateImage
} from './user-textures.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const png = (...bytes: number[]) =>
  new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...bytes])], { type: 'image/png' });
const accept = async () => {};

beforeEach(() => setTextureStorage(memoryTextureStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('hashing', () => {
  it('matches SHA-256 with and without crypto.subtle', async () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 1000]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha256Fallback(bytes)).toBe(sha(bytes));
    }
    const blob = png(1, 2, 3);
    const expected = sha(new Uint8Array(await blob.arrayBuffer()));
    expect(await textureId(blob)).toBe(expected);
    vi.stubGlobal('crypto', {});
    expect(await textureId(blob)).toBe(expected);
  });
});

describe('storage', () => {
  it('stores an image once under its hash', async () => {
    const id = await putUserTexture(png(1));
    expect(await putUserTexture(png(1))).toBe(id);
    expect(await (await getUserTexture(id))?.arrayBuffer()).toEqual(await png(1).arrayBuffer());
    expect(await getUserTexture('f'.repeat(64))).toBeUndefined();
    expect(await getUserTexture('../x')).toBeUndefined();
  });
});

describe('validateImage', () => {
  it('rejects other file types, oversized and unreadable images', async () => {
    await expect(validateImage(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(/PNG, JPEG or WebP/);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 5000, height: 10, close() {} }));
    await expect(validateImage(png())).rejects.toThrow(/5000x10/);
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('broken');
    });
    await expect(validateImage(png())).rejects.toThrow(/not a readable image/);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 512, height: 512, close() {} }));
    await expect(validateImage(png())).resolves.toBeUndefined();
  });
});

describe('export and import', () => {
  it('round-trips stored images as data URLs, leaving out missing ones', async () => {
    const id = await putUserTexture(png(9, 8, 7));
    const embedded = await exportUserTextures([id, id, 'a'.repeat(64)]);
    expect(Object.keys(embedded)).toEqual([id]);
    expect(embedded[id]).toMatch(/^data:image\/png;base64,/);

    setTextureStorage(memoryTextureStorage());
    const issues: string[] = [];
    await importUserTextures(embedded, issues, accept);
    expect(issues).toEqual([]);
    expect(await getUserTexture(id)).toBeDefined();
  });

  it('skips entries that are not images or do not match their id', async () => {
    const good = await exportUserTextures([await putUserTexture(png(1))]);
    const [id, url] = Object.entries(good)[0];
    setTextureStorage(memoryTextureStorage());
    const issues: string[] = [];
    await importUserTextures(
      { ['b'.repeat(64)]: url, ['c'.repeat(64)]: url, bad: url, [id]: 'data:text/html;base64,PGI+' },
      issues,
      accept
    );
    expect(issues).toHaveLength(4);
    expect(issues.join(' ')).toMatch(/does not match/);
    expect(issues.join(' ')).toMatch(/not a texture id/);
    expect(issues.join(' ')).toMatch(/expected a PNG/);
    expect(await getUserTexture(id)).toBeUndefined();
  });
});
