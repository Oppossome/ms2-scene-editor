#!/usr/bin/env node
// Usage: node cmd/extract/extract.js [--game DIR] [--out DIR] [--list] [--force] [archive-filter ...]
// Archives are matched by substring against the paths in PackClient.ini (e.g. "Model/Npc").
const fs = require('fs');
const path = require('path');
const { M2dReader } = require('../../vendor/maple2-file-io/dist');

const args = process.argv.slice(2);
const opts = {
  game: process.env.MS2_DIR || '/home/opossum/.local/share/Steam/steamapps/common/MapleStory 2',
  out: path.resolve(__dirname, '../../extracted'),
  list: false,
  force: false
};
const filters = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--game') opts.game = args[++i];
  else if (args[i] === '--out') opts.out = path.resolve(args[++i]);
  else if (args[i] === '--list') opts.list = true;
  else if (args[i] === '--force') opts.force = true;
  else filters.push(args[i].toLowerCase());
}

const archives = fs
  .readFileSync(path.join(opts.game, 'PackClient.ini'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith('./'))
  .map((l) => l.slice(2))
  .filter((l) => fs.existsSync(path.join(opts.game, l + '.m2d')))
  .filter((l) => filters.length === 0 || filters.some((f) => l.toLowerCase().includes(f)));

// Entry names come from the archive, so never let them escape the output dir.
function safeJoin(root, name) {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  return path.join(root, ...parts);
}

function extractArchive(rel) {
  const reader = new M2dReader(path.join(opts.game, rel + '.m2d'));
  const root = path.join(opts.out, rel.replace(/^Data\//, ''));
  console.log(`${rel}: ${reader.files.length} entries`);
  if (opts.list) {
    for (const e of reader.files) console.log('  ' + e.name);
    fs.closeSync(reader.fileDescriptor);
    return { failed: [] };
  }

  let written = 0,
    skipped = 0;
  const failed = [];
  const manifest = [];
  const started = Date.now();
  reader.files.forEach((entry, i) => {
    const dest = safeJoin(root, entry.name);
    try {
      if (
        !opts.force &&
        fs.existsSync(dest) &&
        entry.fileHeader &&
        BigInt(fs.statSync(dest).size) === entry.fileHeader.fileSize
      ) {
        skipped++;
        manifest.push({ name: entry.name, size: fs.statSync(dest).size });
        return;
      }
      const data = reader.getBytes(entry).getBuffer();
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      manifest.push({ name: entry.name, size: data.length });
      written++;
    } catch (err) {
      failed.push({ name: entry.name, error: err.message });
    }
    if ((i + 1) % 5000 === 0)
      console.log(`  ${i + 1}/${reader.files.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  });

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, '_manifest.json'),
    JSON.stringify({ archive: rel, entries: manifest, failed }, null, 1)
  );
  console.log(`  done: ${written} written, ${skipped} skipped, ${failed.length} failed`);
  for (const f of failed.slice(0, 5)) console.log(`    FAIL ${f.name}: ${f.error}`);
  fs.closeSync(reader.fileDescriptor);
  return { failed };
}

let totalFailed = 0;
for (const rel of archives) {
  try {
    totalFailed += extractArchive(rel).failed.length;
  } catch (err) {
    console.log(`${rel}: ERROR ${err.message}`);
    totalFailed++;
  }
}
console.log(totalFailed ? `Finished with ${totalFailed} failures` : 'Finished OK');
process.exit(totalFailed ? 1 : 0);
