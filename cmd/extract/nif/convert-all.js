#!/usr/bin/env node
// Batch NIF -> GLB for everything under extracted/Resource/Model (textures referenced, not embedded).
// Usage: node cmd/extract/nif/convert-all.js [--force] [--no-animations] [subdir ...]
// Output: extracted/converted/models/<same relative path>.glb (with the .kf clips from the same folder embedded).
// Models with more than EMBED_LIMIT clips get skeleton-only per-clip GLBs in <model>.anims/ (or <folder>/_clips/ when the folder holds several models).
const fs = require('fs');
const path = require('path');
const { convert, findKfFiles } = require('./to-gltf');

// Models with more clips than this get one skeleton-only GLB per clip (<model>.anims/<clip>.glb) instead of embedding them all.
const EMBED_LIMIT = 64;

const modelRoot = path.resolve(__dirname, '../../../extracted/Resource/Model');
const outRoot = path.resolve(__dirname, '../../../extracted/converted/models');
const failLog = path.resolve(__dirname, '../../../convert-models.failed.log');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.toLowerCase().endsWith('.nif')) yield full;
  }
}

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const force = flags.includes('--force');
const withAnimations = !flags.includes('--no-animations');
const subdirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const roots = subdirs.length ? subdirs.map((s) => path.join(modelRoot, s)) : [modelRoot];
const totals = {
  converted: 0,
  noGeometry: 0,
  failed: 0,
  skipped: 0,
  missingTextureFiles: 0,
  indexOutOfRange: 0,
  skinnedFiles: 0,
  modelsWithAnimations: 0,
  embeddedClips: 0,
  clipFiles: 0,
  clipErrors: 0
};
const failures = [];
const clipDirsDone = new Set();
const missing = new Map();
const started = Date.now();
let n = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const dest = path.join(outRoot, path.relative(modelRoot, file).replace(/\.nif$/i, '.glb'));
    if (!force && fs.existsSync(dest)) {
      totals.skipped++;
      continue;
    }
    try {
      const kfs = withAnimations ? findKfFiles(file) : [];
      const embed = kfs.length <= EMBED_LIMIT;
      const { glb, stats } = convert(file, { externalTexturesFrom: path.dirname(dest), animations: embed ? kfs : [] });
      if (stats.primitives === 0) {
        totals.noGeometry++;
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, glb);
      totals.converted++;
      if (stats.animations) {
        totals.modelsWithAnimations++;
        totals.embeddedClips += stats.animations;
      }
      if (stats.animationErrors) totals.clipErrors += stats.animationErrors.length;
      // Folders with several models usually share one skeleton, so their big clip sets are written once into _clips/.
      const sharedDir = fs.readdirSync(path.dirname(file)).filter((f) => f.toLowerCase().endsWith('.nif')).length > 1;
      const clipDir = sharedDir ? path.join(path.dirname(dest), '_clips') : dest.replace(/\.glb$/, '.anims');
      if (!embed && !(sharedDir && clipDirsDone.has(clipDir))) {
        clipDirsDone.add(clipDir);
        for (const kf of kfs) {
          try {
            const clip = convert(file, { skeletonOnly: true, animations: [kf] });
            if (!clip.stats.animations) continue;
            fs.mkdirSync(clipDir, { recursive: true });
            fs.writeFileSync(path.join(clipDir, path.basename(kf).replace(/\.kf$/i, '.glb')), clip.glb);
            totals.clipFiles++;
          } catch (e) {
            totals.clipErrors++;
            failures.push(`${path.relative(modelRoot, kf)}: ${e.message}`);
          }
        }
      }
      if (stats.skinned) totals.skinnedFiles++;
      totals.indexOutOfRange += stats.indexOutOfRange || 0;
      for (const m of stats.missingTextures) missing.set(m.toLowerCase(), (missing.get(m.toLowerCase()) || 0) + 1);
    } catch (e) {
      totals.failed++;
      failures.push(`${path.relative(modelRoot, file)}: ${e.message}`);
    }
    if (++n % 2000 === 0) console.log(n, totals, `${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}
totals.missingTextureFiles = missing.size;
fs.writeFileSync(failLog, failures.join('\n') + '\n');
console.log('done', totals);
console.log('most-referenced missing textures:', [...missing].sort((a, b) => b[1] - a[1]).slice(0, 8));
console.log('sample failures:', failures.slice(0, 8));
