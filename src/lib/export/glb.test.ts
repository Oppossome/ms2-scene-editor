import { describe, expect, it } from 'vitest';
import { dropSkeletonRoots, editGlbJson, safeFilename } from './glb';

describe('safeFilename', () => {
  it('keeps names file-system friendly', () => {
    expect(safeFilename("Lay's Hair (F)")).toBe('Lay_s_Hair_F.glb');
    expect(safeFilename('///')).toBe('export.glb');
    expect(safeFilename('scene', 'json')).toBe('scene.json');
  });
});

/** A minimal GLB: JSON chunk plus a 4-byte BIN chunk. */
function makeGlb(json: object): ArrayBuffer {
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const bin = new Uint8Array([1, 2, 3, 4]);
  const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  v.setUint32(binStart, bin.length, true);
  v.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out.buffer;
}

function readGlb(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  const jsonLength = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binStart = 20 + jsonLength;
  return { json, total: v.getUint32(8, true), length: buffer.byteLength, bin: [...new Uint8Array(buffer, binStart + 8, v.getUint32(binStart, true))] };
}

describe('GLB json editing', () => {
  it('rewrites the JSON chunk and keeps the binary chunk and header consistent', () => {
    const edited = editGlbJson(makeGlb({ asset: { version: '2.0' }, extra: 'x'.repeat(7) }), (j) => {
      j.added = 'a longer value than before';
    });
    const r = readGlb(edited);
    expect(r.json.added).toBe('a longer value than before');
    expect(r.total).toBe(r.length);
    expect(r.bin).toEqual([1, 2, 3, 4]);
    expect(r.length % 4).toBe(0);
  });

  it('drops skin skeleton roots only', () => {
    const r = readGlb(dropSkeletonRoots(makeGlb({ skins: [{ joints: [1, 2], skeleton: 1 }, { joints: [3] }], nodes: [{}] })));
    expect(r.json.skins).toEqual([{ joints: [1, 2] }, { joints: [3] }]);
    expect(r.json.nodes).toEqual([{}]);
  });

  it('rejects non-GLB data', () => {
    expect(() => editGlbJson(new ArrayBuffer(32), () => undefined)).toThrow('Not a GLB');
  });
});
