import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearDirCache, parseRange, resolveAssetPath } from './assets';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  fs.mkdirSync(path.join(root, 'converted/Models/Character'), { recursive: true });
  fs.writeFileSync(path.join(root, 'converted/Models/Character/f_body.glb'), 'glb');
  fs.mkdirSync(path.join(root, 'converted/Models/My Folder'), { recursive: true });
  fs.writeFileSync(path.join(root, 'converted/Models/My Folder/a b.glb'), 'x');
  fs.mkdirSync(path.join(root, 'secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'secret/key.txt'), 'nope');
  fs.writeFileSync(path.join(path.dirname(root), 'outside.txt'), 'outside');
  clearDirCache();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('resolveAssetPath', () => {
  it('matches any letter case', () => {
    expect(resolveAssetPath('Converted/models/CHARACTER/F_Body.GLB', root)).toBe(
      path.join(root, 'converted/Models/Character/f_body.glb')
    );
  });

  it('handles spaces and backslashes', () => {
    expect(resolveAssetPath('converted\\models\\my folder\\A B.glb', root)).not.toBeNull();
  });

  it('rejects traversal and absolute paths', () => {
    expect(resolveAssetPath('converted/../secret/key.txt', root)).toBeNull();
    expect(resolveAssetPath('converted/models/../../../outside.txt', root)).toBeNull();
    expect(resolveAssetPath('/etc/passwd', root)).toBeNull();
    expect(resolveAssetPath('converted/a\0b', root)).toBeNull();
  });

  it('rejects folders outside the allowlist and directories', () => {
    expect(resolveAssetPath('secret/key.txt', root)).toBeNull();
    expect(resolveAssetPath('converted/models', root)).toBeNull();
  });
});

describe('parseRange', () => {
  it('parses explicit, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 });
  });

  it('returns null for invalid ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=200-300', 100)).toBeNull();
    expect(parseRange('garbage', 100)).toBeNull();
  });
});
