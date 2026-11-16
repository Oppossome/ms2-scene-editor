import { describe, expect, it } from 'vitest';
import { parseDummies, parseEffectXml } from './effects.js';

const resolve = (file: string) => (file.toLowerCase().includes('missing') ? null : `Effect/${file}`);

describe('effect XML', () => {
  it('reads NIF entries with their timing and placement, and skips what the studio does not play', () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<ms2>
  <effect type="soundEvent" group="MS2Sound/Sound/Object" event="03500046" />
  <effect type="nif" filePath="CH/Skill/Eff_A.nif" startDelay="0.25" duration="2" loop="true">
    <attachInfo attachToNode="false" applyNodeTransform="true" parentNode="Bip01 R Hand" />
    <transform translate="0.0, 10.0, 120.0" rotation="0.0, -90.0, 0.0" scale="1.4" />
  </effect>
  <effect type="nif" filePath="Missing.nif">
    <attachInfo parentNode="" />
  </effect>
</ms2>`;
    const [a, b, ...rest] = parseEffectXml(xml, resolve);
    expect(rest).toHaveLength(0);
    expect(a).toEqual({
      kind: 'nif',
      file: 'CH/Skill/Eff_A.nif',
      glb: 'Effect/CH/Skill/Eff_A.nif',
      startDelay: 0.25,
      duration: 2,
      loop: true,
      parentNode: 'Bip01 R Hand',
      attachToNode: false,
      applyNodeTransform: true,
      translate: [0, 10, 120],
      rotation: [0, -90, 0],
      scale: 1.4
    });
    expect(b).toMatchObject({ glb: null, duration: null, loop: false, parentNode: 'Scene Root', scale: 1 });
  });

  it('keeps random groups as weighted choices', () => {
    const xml = `<ms2><effect type="random" prob="1,3">
      <effect type="nif" filePath="a.nif" startDelay="0"><attachInfo parentNode="Scene Root" /></effect>
      <effect type="nif" filePath="b.nif" startDelay="0"><attachInfo parentNode="Scene Root" /></effect>
    </effect></ms2>`;
    const [random] = parseEffectXml(xml, resolve);
    expect(random).toMatchObject({ kind: 'random', weights: [1, 3] });
    expect(random.kind === 'random' && random.options.map((o) => o.kind === 'nif' && o.file)).toEqual([
      'a.nif',
      'b.nif'
    ]);
  });
});

describe('effect dummies', () => {
  it('reads player dummies for one gender and default dummies', () => {
    const pc = `<ms2><effectdummy>
      <dummy name="Eff_Head" gender="0">
        <attachInfo parentNode="Bip01 Head" applyWorldTransform="false" applyLocalScale="true" />
        <transform translate="80.0, 0.0, 0.0" rotation="0.0, 0.0, 0.0" scale="1.0" />
      </dummy>
      <dummy name="Eff_Head" gender="1">
        <attachInfo parentNode="Bip01 Head" applyWorldTransform="false" />
        <transform translate="75.0, 0.0, 0.0" rotation="0.0, 0.0, 0.0" scale="1.0" />
      </dummy>
      <dummy name="Eff_UI" gender="1">
        <attachInfo parentNode="Scene Root" applyWorldTransform="true" />
        <transform translate="0.0, 0.0, 170.0" rotation="0.0, 0.0, 0.0" scale="1.0" />
      </dummy>
    </effectdummy></ms2>`;
    expect(parseDummies(pc, 1)).toEqual([
      {
        name: 'Eff_Head',
        parentNode: 'Bip01 Head',
        translate: [75, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
        world: false
      },
      { name: 'Eff_UI', parentNode: 'Scene Root', translate: [0, 0, 170], rotation: [0, 0, 0], scale: 1, world: true }
    ]);
    const defaults = `<ms2><dummy name="Eff_Body"><attachInfo parentNode="Scene Root" /></dummy></ms2>`;
    expect(parseDummies(defaults)).toMatchObject([
      { name: 'Eff_Body', parentNode: 'Scene Root', translate: [0, 0, 0] }
    ]);
  });
});
