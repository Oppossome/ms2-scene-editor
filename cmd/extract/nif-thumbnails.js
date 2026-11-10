#!/usr/bin/env node
// Pulls the embedded PNG preview out of every .nif under extracted/Resource/Model.
// MS2 NIFs store a PNG thumbnail right after a short custom header; the mesh blocks are not converted.
// Usage: node cmd/extract/nif-thumbnails.js [model-subdir ...]
const fs = require('fs');
const path = require('path');

const modelRoot = path.resolve(__dirname, '../../extracted/Resource/Model');
const outRoot = path.resolve(__dirname, '../../extracted/converted/model-previews');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngLength(buf, start) {
  let p = start + 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    p += 12 + len;
    if (type === 'IEND') return p - start;
  }
  return 0;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.toLowerCase().endsWith('.nif')) yield full;
  }
}

const subdirs = process.argv.slice(2);
const roots = subdirs.length ? subdirs.map((s) => path.join(modelRoot, s)) : [modelRoot];
let found = 0,
  missing = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    // The header is tiny, so only read the first 64 KB looking for the signature.
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(65536);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const idx = head.subarray(0, Math.min(n, 256)).indexOf(PNG_SIG);
    if (idx < 0) {
      missing++;
      continue;
    }
    const whole = n === head.length ? fs.readFileSync(file) : head.subarray(0, n);
    const len = pngLength(whole, idx);
    if (!len) {
      missing++;
      continue;
    }
    const dest = path.join(outRoot, path.relative(modelRoot, file).replace(/\.nif$/i, '.png'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, whole.subarray(idx, idx + len));
    found++;
  }
}
console.log(`previews written: ${found}, nifs without preview: ${missing}`);
