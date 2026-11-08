import fs from 'node:fs';
import path from 'node:path';
import type { ClipInfo } from '../types.js';

interface GltfJson {
  accessors?: { max?: number[] }[];
  animations?: { samplers?: { input?: number }[] }[];
}

/** Length of a clip in seconds: the latest keyframe time over every sampler of every animation. */
export function durationFromGltfJson(json: GltfJson): number {
  let longest = 0;
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      const end = sampler.input === undefined ? undefined : json.accessors?.[sampler.input]?.max?.[0];
      if (typeof end === 'number' && Number.isFinite(end) && end > longest) longest = end;
    }
  }
  return Math.round(longest * 1000) / 1000;
}

/** The JSON chunk of a binary glTF, read without loading the binary data. Null when it is not a usable GLB. */
export function readGlbJson(file: string): GltfJson | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return null;
    if (head.readUInt32LE(0) !== 0x46546c67 || head.readUInt32LE(16) !== 0x4e4f534a) return null;
    const length = head.readUInt32LE(12);
    const body = Buffer.alloc(length);
    if (fs.readSync(fd, body, 0, length, 20) < length) return null;
    return JSON.parse(body.toString('utf8')) as GltfJson;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const cache = new Map<string, { mtimeMs: number; clips: ClipInfo[] }>();

function readCacheFile(file: string, mtimeMs: number): ClipInfo[] | null {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { mtimeMs?: number; clips?: ClipInfo[] };
    return saved.mtimeMs === mtimeMs && Array.isArray(saved.clips) ? saved.clips : null;
  } catch {
    return null;
  }
}

/**
 * The per-clip GLB files of a body's `.anims` folder with their durations, sorted by name. Memoised per folder
 * until its modification time changes; with `cacheFile` the result also survives restarts (scanning about 1,900
 * files takes a while on a cold disk). Null when the folder does not exist.
 */
export function listClips(dir: string, cacheFile?: string): ClipInfo[] | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(dir);
  if (hit && hit.mtimeMs === mtimeMs) return hit.clips;
  const saved = cacheFile ? readCacheFile(cacheFile, mtimeMs) : null;
  if (saved) {
    cache.set(dir, { mtimeMs, clips: saved });
    return saved;
  }

  const clips = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .map((f) => {
      const json = readGlbJson(path.join(dir, f));
      return { name: f.replace(/\.glb$/i, ''), duration: json ? durationFromGltfJson(json) : 0 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  cache.set(dir, { mtimeMs, clips });
  if (cacheFile) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ mtimeMs, clips }));
    } catch {
      // A read-only data folder only means the scan repeats after a restart.
    }
  }
  return clips;
}
