import fs from 'node:fs';
import path from 'node:path';

/** Root folder of the extracted game assets. */
export const EXTRACTED_ROOT = path.resolve(process.env.MS2_EXTRACTED ?? 'extracted');

/** Top-level folders (lowercase, relative to the root) the asset route may serve. */
export const ALLOWED_PREFIXES = ['converted', 'resource/image'];

export const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4'
};

const dirCache = new Map<string, Map<string, string>>();

/** Case-insensitive view of a directory: lowercase name -> actual name. */
function listDir(dir: string): Map<string, string> {
  let entries = dirCache.get(dir);
  if (!entries) {
    entries = new Map();
    try {
      for (const name of fs.readdirSync(dir)) entries.set(name.toLowerCase(), name);
    } catch {
      // missing directory: leave empty
    }
    dirCache.set(dir, entries);
  }
  return entries;
}

export function clearDirCache() {
  dirCache.clear();
}

/**
 * Resolve a URL-style path (any letter case, `/` or `\` separators) to a real file under `root`.
 * Only walks existing directory entries, so `..` and absolute paths can never escape the root.
 * Returns null when the path is not allowed or does not exist.
 */
export function resolveAssetPath(
  urlPath: string,
  root: string = EXTRACTED_ROOT,
  allowed: string[] = ALLOWED_PREFIXES
): string | null {
  if (urlPath.includes('\0')) return null;
  const segments = urlPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.some((s) => s === '..')) return null;

  const lower = segments.map((s) => s.toLowerCase()).join('/');
  if (!allowed.some((prefix) => lower === prefix || lower.startsWith(prefix + '/'))) return null;

  let current = root;
  for (const segment of segments) {
    const actual = listDir(current).get(segment.toLowerCase());
    if (actual === undefined) return null;
    current = path.join(current, actual);
  }
  try {
    return fs.statSync(current).isFile() ? current : null;
  } catch {
    return null;
  }
}

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Parse a single-range `Range: bytes=a-b` header. Returns null for absent or unsatisfiable ranges. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] !== '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end };
}
