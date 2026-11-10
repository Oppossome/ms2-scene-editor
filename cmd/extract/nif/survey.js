#!/usr/bin/env node
// Survey: header-parse every NIF and tally block types (normalised) and failures.
const fs = require('fs');
const path = require('path');
const { parseHeader } = require('./header');

const EXT = '.' + (process.argv[2] || 'nif');
const root = path.resolve(__dirname, '../../../extracted/Resource/Model');
const counts = new Map();
const files = new Map();
const versions = new Map();
let ok = 0,
  bad = 0,
  sizeMismatch = 0;
const badSamples = [];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.toLowerCase().endsWith(EXT)) yield full;
  }
}

for (const f of walk(root)) {
  try {
    const buf = fs.readFileSync(f);
    const h = parseHeader(buf);
    ok++;
    versions.set(
      h.magic.slice(-8) + ' uv' + h.userVersion,
      (versions.get(h.magic.slice(-8) + ' uv' + h.userVersion) || 0) + 1
    );
    if (h.end + 4 > buf.length || h.end > buf.length) sizeMismatch++;
    const seen = new Set();
    for (const b of h.blocks) {
      // Block type names may contain binary suffixes that the survey deliberately strips.
      // eslint-disable-next-line no-control-regex
      const t = b.type.replace(/[\x00-\x1f].*$/s, '*');
      counts.set(t, (counts.get(t) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        files.set(t, (files.get(t) || 0) + 1);
      }
    }
  } catch (e) {
    bad++;
    if (badSamples.length < 5) badSamples.push(f + ': ' + e.message);
  }
}
console.log({ ok, bad, sizeMismatch });
console.log(badSamples.join('\n'));
console.log([...versions]);
for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1]))
  console.log(String(n).padStart(8), String(files.get(t)).padStart(7), t);
