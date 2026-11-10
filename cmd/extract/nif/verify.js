#!/usr/bin/env node
// Verify the hand-written block parsers against the header block sizes across every NIF.
const fs = require('fs');
const path = require('path');
const { parseHeader } = require('./header');
const { parseBlock } = require('./parse');

const EXT = '.' + (process.argv[2] || 'nif');
const root = path.resolve(__dirname, '../../../extracted/Resource/Model');
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.toLowerCase().endsWith(EXT)) yield full;
  }
}

const stats = {};
const samples = {};
const formatTally = new Map();
const semanticTally = new Map();
for (const f of walk(root)) {
  const buf = fs.readFileSync(f);
  const h = parseHeader(buf);
  for (const b of h.blocks) {
    const base = b.type.split('\x01')[0];
    if (
      ![
        'NiNode',
        'NiMesh',
        'NiDataStream',
        'NiTexturingProperty',
        'NiSourceTexture',
        'NiMaterialProperty',
        'NiAlphaProperty',
        'NiSkinningMeshModifier',
        'NiTransformData',
        'NiTransformEvaluator',
        'NiBSplineCompTransformEvaluator',
        'NiBSplineData',
        'NiBSplineBasisData',
        'NiTextKeyExtraData',
        'NiSequenceData'
      ].includes(base)
    )
      continue;
    const s = (stats[base] ||= { ok: 0, bad: 0 });
    try {
      const o = parseBlock(buf, h, b);
      if (o.consumed === b.size) {
        s.ok++;
        if (base === 'NiDataStream')
          for (const fm of o.formats)
            formatTally.set(
              fm.type + 'x' + fm.count + (fm.normalized ? 'n' : ''),
              (formatTally.get(fm.type + 'x' + fm.count + (fm.normalized ? 'n' : '')) || 0) + 1
            );
        if (base === 'NiMesh')
          for (const st of o.streams)
            for (const se of st.semantics) semanticTally.set(se.name, (semanticTally.get(se.name) || 0) + 1);
      } else {
        s.bad++;
        (samples[base] ||= []).length < 3 &&
          samples[base].push(`${path.relative(root, f)} #${b.index} consumed ${o.consumed} size ${b.size}`);
      }
    } catch (e) {
      s.bad++;
      (samples[base] ||= []).length < 3 && samples[base].push(`${path.relative(root, f)} #${b.index} ${e.message}`);
    }
  }
}
console.log(stats, samples);
console.log(
  'formats',
  [...formatTally].sort((a, b) => b[1] - a[1])
);
console.log(
  'semantics',
  [...semanticTally].sort((a, b) => b[1] - a[1])
);
