import { TextureLoader, type Texture } from 'three';

/**
 * Images the user loads onto items (texture overrides). They never leave the browser: blobs live in IndexedDB, keyed
 * by the SHA-256 of their bytes, so a scene only stores short ids and the same image is kept once. Scene JSON export
 * embeds the images it uses (`exportUserTextures`) and import puts them back (`importUserTextures`).
 */

export const USER_TEXTURE_ID = /^[0-9a-f]{64}$/;
export const USER_TEXTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_TEXTURE_BYTES = 16 * 1024 * 1024;
export const MAX_TEXTURE_SIZE = 4096;

export interface TextureStorage {
  get(id: string): Promise<Blob | undefined>;
  put(id: string, blob: Blob): Promise<void>;
}

export function memoryTextureStorage(): TextureStorage {
  const blobs = new Map<string, Blob>();
  return {
    get: async (id) => blobs.get(id),
    put: async (id, blob) => void blobs.set(id, blob)
  };
}

const DB_NAME = 'ms2se';
const STORE = 'textures';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB storage; null when the browser has none (or refuses it, as some private windows do). */
async function indexedDbStorage(): Promise<TextureStorage | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    const db = await request(open);
    return {
      get: async (id) => (await request(db.transaction(STORE).objectStore(STORE).get(id))) as Blob | undefined,
      put: async (id, blob) => {
        await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, id));
      }
    };
  } catch (error) {
    console.warn('IndexedDB is unavailable; loaded textures last until the page closes.', error);
    return null;
  }
}

let storage: Promise<TextureStorage> | null = null;
const getStorage = () => (storage ??= indexedDbStorage().then((s) => s ?? memoryTextureStorage()));

/** Use another storage (tests). Clears the caches. */
export function setTextureStorage(next: TextureStorage) {
  storage = Promise.resolve(next);
  textureCache.clear();
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

// ----- hashing -----

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** Plain SHA-256, for pages served over plain HTTP (a LAN address), where `crypto.subtle` does not exist. */
export function sha256Fallback(bytes: Uint8Array): string {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(padded.length - 4, (length << 3) >>> 0, false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The id of an image: the SHA-256 of its bytes, in hex. */
export async function textureId(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  return subtle ? toHex(await subtle.digest('SHA-256', bytes)) : sha256Fallback(bytes);
}

// ----- storing and reading -----

/**
 * Check that a file is an image the app can use: PNG, JPEG or WebP, at most 16 MB and 4096 px a side. Throws a
 * message for the user otherwise.
 */
export async function validateImage(blob: Blob): Promise<void> {
  if (!USER_TEXTURE_TYPES.includes(blob.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  if (blob.size > MAX_TEXTURE_BYTES) throw new Error('The image is larger than 16 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('The file is not a readable image.');
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width > MAX_TEXTURE_SIZE || height > MAX_TEXTURE_SIZE)
    throw new Error(`The image is ${width}x${height}; the largest allowed is ${MAX_TEXTURE_SIZE} px a side.`);
}

/** Keep an image in the browser and return its id (the same image always gets the same id). */
export async function putUserTexture(blob: Blob): Promise<string> {
  const id = await textureId(blob);
  const store = await getStorage();
  if (!(await store.get(id))) await store.put(id, blob);
  return id;
}

export async function getUserTexture(id: string): Promise<Blob | undefined> {
  if (!USER_TEXTURE_ID.test(id)) return undefined;
  return (await getStorage()).get(id);
}

const objectUrls = new Map<string, string>();

/** An object URL showing a stored image (for thumbnails and downloads); undefined when it is not stored. */
export async function userTextureUrl(id: string): Promise<string | undefined> {
  const hit = objectUrls.get(id);
  if (hit) return hit;
  const blob = await getUserTexture(id);
  if (!blob) return undefined;
  const url = objectUrls.get(id) ?? URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}

const loader = new TextureLoader();
const textureCache = new Map<string, Promise<Texture>>();

/** A stored image as a three.js texture (cached); rejects when this browser does not have it. */
export function loadUserTexture(id: string): Promise<Texture> {
  let hit = textureCache.get(id);
  if (!hit) {
    hit = userTextureUrl(id).then((url) => {
      if (!url) throw new Error(`Texture ${id.slice(0, 8)} is not stored in this browser`);
      return loader.loadAsync(url);
    });
    hit.catch(() => textureCache.delete(id));
    textureCache.set(id, hit);
  }
  return hit;
}

// ----- export / import -----

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** The stored images among `ids` as data URLs, for embedding in an exported file. Missing ones are left out. */
export async function exportUserTextures(ids: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const blob = await getUserTexture(id);
    if (blob) out[id] = await dataUrl(blob);
  }
  return out;
}

/**
 * Store images embedded in an imported file. Each must be an image whose bytes hash to its id; others are skipped
 * and reported in `issues`. `validate` defaults to `validateImage`.
 */
export async function importUserTextures(
  embedded: Record<string, unknown>,
  issues: string[] = [],
  validate: (blob: Blob) => Promise<void> = validateImage
): Promise<void> {
  for (const [id, value] of Object.entries(embedded)) {
    const path = `textures.${id.slice(0, 12)}`;
    try {
      if (!USER_TEXTURE_ID.test(id)) throw new Error('not a texture id');
      if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(value))
        throw new Error('expected a PNG, JPEG or WebP data URL');
      const blob = await (await fetch(value)).blob();
      await validate(blob);
      if ((await textureId(blob)) !== id) throw new Error('the image does not match its id');
      await putUserTexture(blob);
    } catch (error) {
      issues.push(`${path}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
