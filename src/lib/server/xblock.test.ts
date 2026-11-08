import { describe, expect, it } from 'vitest';
import { parseNumbers, parseXblock } from './xblock';

const xml = `<?xml version="1.0" encoding="utf-8"?>
<game>
  <entitySet>
    <entity id="a" modelName="Crate_A_" name="Crate_A_[0]" iterations="1">
      <property name="Position"><set value="100, 200, 300" /></property>
      <property name="Rotation"><set value="0, 0, 90" /></property>
    </entity>
    <entity id="b" modelName="crate_a_" name="Crate_A_[1]">
      <property name="Position"><set value="-5, 0, 0.5" /></property>
      <property name="Scale"><set value="2" /></property>
    </entity>
    <entity id="c" modelName="Barrel_" name="Barrel">
      <property name="Position"><set value="1, 1, 1" /></property>
      <property name="Scale"><set value="1, 2, 3" /></property>
    </entity>
    <entity id="d" modelName="Crate_A_" name="Hidden">
      <property name="IsVisible"><set value="False" /></property>
    </entity>
    <entity id="e" modelName="MS2Waypoint" name="wp">
      <property name="Position"><set value="0, 0, 0" /></property>
    </entity>
    <entity id="f" modelName="Crate_A_" name="Override">
      <property name="NifAsset"><set value="urn:llid:ABCDEF12-0000-0000-0000-000000000000" /></property>
      <property name="Position"><set value="7, 8, 9" /></property>
    </entity>
  </entitySet>
</game>`;

const flats = { crate_a_: 'Map/crate.glb', barrel_: 'Map/barrel.glb' };
const llids = { 'abcdef12-0000-0000-0000-000000000000': 'Map/special.glb' };

describe('parseNumbers', () => {
  it('parses an exact count of finite numbers', () => {
    expect(parseNumbers('1, 2.5, -3', 3)).toEqual([1, 2.5, -3]);
    expect(parseNumbers('1, 2', 3)).toBeNull();
    expect(parseNumbers('a, b, c', 3)).toBeNull();
    expect(parseNumbers(undefined, 3)).toBeNull();
  });
});

describe('parseXblock', () => {
  const result = parseXblock(xml, flats, llids);

  it('shares models between entities and resolves names case-insensitively', () => {
    expect(result.models).toEqual(['Map/crate.glb', 'Map/barrel.glb', 'Map/special.glb']);
    expect(result.items[0]).toEqual([0, 100, 200, 300, 0, 0, 90, 1, 1, 1]);
    expect(result.items[1][0]).toBe(0);
  });

  it('reads uniform and per-axis scale', () => {
    expect(result.items[1].slice(7)).toEqual([2, 2, 2]);
    expect(result.items[2].slice(7)).toEqual([1, 2, 3]);
  });

  it('skips hidden entities and counts unresolved ones', () => {
    expect(result.items).toHaveLength(4);
    expect(result.total).toBe(6);
    expect(result.unresolved).toEqual({ ms2waypoint: 1 });
  });

  it('lets an entity NifAsset override its flat model', () => {
    expect(result.items[3][0]).toBe(2);
    expect(result.items[3].slice(1, 4)).toEqual([7, 8, 9]);
  });
});
