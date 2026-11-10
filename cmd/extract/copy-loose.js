#!/usr/bin/env node
// Copies the unpacked (non-.m2d) game assets into extracted/.
const fs = require('fs');
const path = require('path');

const game = process.env.MS2_DIR || '/home/opossum/.local/share/Steam/steamapps/common/MapleStory 2';
const out = path.resolve(__dirname, '../../extracted');

const items = [
  ['Custom', 'Custom'],
  ['Data/Sound', 'Sound'],
  ['Data/Shaders', 'Shaders'],
  ['Data/Resource/gfx', 'Resource/gfx'],
  ['Config.ini', 'Config.ini']
];

for (const [from, to] of items) {
  const src = path.join(game, from);
  if (!fs.existsSync(src)) continue;
  console.log(`${from} -> extracted/${to}`);
  fs.cpSync(src, path.join(out, to), { recursive: true });
}
