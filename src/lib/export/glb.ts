import type { AnimationClip, Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { bakeTints } from './bake.js';

export interface GlbOptions {
  /** Clips to include. Only meaningful when exporting a single rig (track names address nodes by name). */
  animations?: AnimationClip[];
  /** Bake palette tints into the diffuse textures (otherwise tinted parts export untinted). Default true. */
  bakeTints?: boolean;
}

/**
 * Rewrite the JSON chunk of a binary glTF. The BIN chunk is copied unchanged.
 */
export function editGlbJson(buffer: ArrayBuffer, edit: (json: Record<string, unknown>) => void): ArrayBuffer {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as Record<string, unknown>;
  edit(json);
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).length % 4 !== 0) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const rest = new Uint8Array(buffer, 20 + jsonLength); // BIN chunk header and data
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const outView = new DataView(out.buffer);
  out.set(new Uint8Array(buffer, 0, 12), 0);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, jsonBytes.length, true);
  out.set(new Uint8Array(buffer, 16, 4), 16);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out.buffer;
}

/**
 * three.js picks a `skeleton` root per skin that is not always a common ancestor of the joints (clothes on a shared
 * body skeleton), which strict validators reject. The property is optional, so drop it.
 */
export function dropSkeletonRoots(buffer: ArrayBuffer): ArrayBuffer {
  return editGlbJson(buffer, (json) => {
    for (const skin of (json.skins as Record<string, unknown>[] | undefined) ?? []) delete skin.skeleton;
  });
}

/** Export one or more live objects (with their current pose) as a binary glTF. Hidden objects are skipped. */
export async function exportGlb(input: Object3D | Object3D[], options: GlbOptions = {}): Promise<ArrayBuffer> {
  const objects = Array.isArray(input) ? input : [input];
  const restores = options.bakeTints === false ? [] : objects.map((o) => bakeTints(o));
  try {
    const result = await new GLTFExporter().parseAsync(objects.length === 1 ? objects[0] : objects, {
      binary: true,
      onlyVisible: true,
      maxTextureSize: 2048,
      animations: options.animations ?? []
    });
    if (!(result instanceof ArrayBuffer)) throw new Error('Exporter did not return a binary glTF');
    return dropSkeletonRoots(result);
  } finally {
    for (const restore of restores) restore();
  }
}

export function downloadBuffer(buffer: ArrayBuffer, filename: string, type = 'model/gltf-binary') {
  downloadBlob(new Blob([buffer], { type }), filename);
}

/** Save a blob as a file (a download made in the page; nothing is sent anywhere). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-system friendly name. */
export function safeFilename(name: string, ext = 'glb'): string {
  const base = name.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'export';
  return `${base}.${ext}`;
}
