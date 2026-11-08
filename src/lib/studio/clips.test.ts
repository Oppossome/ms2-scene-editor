import { describe, expect, it } from 'vitest';
import type { ClipInfo } from '../types';
import { filterClips, formatDuration, groupClips, groupOf } from './clips';

const clip = (name: string, duration = 1): ClipInfo => ({ name, duration });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => clip(`${prefix}_${String(i).padStart(2, '0')}`));

describe('groupClips', () => {
  it('keeps short lists flat and an empty list empty', () => {
    const short = [clip('walk_a'), clip('idle_a')];
    expect(groupClips(short)).toEqual([{ id: 'all', label: '', clips: [clip('idle_a'), clip('walk_a')] }]);
    expect(groupClips([])).toEqual([]);
  });

  it('groups by first token: basic first, then by size, small prefixes in Other', () => {
    const clips = [
      ...many('emotion', 6),
      ...many('ride', 9),
      ...many('knight', 5),
      clip('idle_a'),
      clip('run_a'),
      ...many('jump', 5),
      clip('zzz_a'),
      clip('aaa_a'),
      ...many('filler', 4)
    ];
    const groups = groupClips(clips);
    expect(groups.map((g) => g.id)).toEqual(['#basic', 'ride', 'emotion', 'knight', 'filler', '#other']);
    expect(groups[0].label).toBe('Basic');
    expect(groups[0].clips.map((c) => c.name)).toContain('idle_a');
    expect(groups[0].clips.map((c) => c.name)).toContain('jump_00');
    expect(groups[1]).toMatchObject({ label: 'Ride' });
    expect(groups[groups.length - 1].clips.map((c) => c.name)).toEqual(['aaa_a', 'zzz_a']);
  });

  it('puts every clip in exactly one group, sorted by name inside it', () => {
    const clips = [...many('b', 12), ...many('a', 12), clip('c_x')];
    const groups = groupClips(clips);
    expect(groups.flatMap((g) => g.clips)).toHaveLength(clips.length);
    for (const g of groups) {
      const names = g.clips.map((c) => c.name);
      expect(names).toEqual([...names].sort());
    }
  });

  it('has no Basic or Other group when nothing belongs there', () => {
    const groups = groupClips([...many('a', 15), ...many('b', 15)]);
    expect(groups.map((g) => g.id)).toEqual(['a', 'b']);
  });
});

describe('filterClips', () => {
  const clips = [clip('emotion_kiss_a'), clip('emotion_cry_a'), clip('ride_run_024')];

  it('returns everything for a blank query', () => {
    expect(filterClips(clips, '  ')).toBe(clips);
  });

  it('needs every term, in any order, ignoring case and underscores', () => {
    expect(filterClips(clips, 'EMOTION kiss').map((c) => c.name)).toEqual(['emotion_kiss_a']);
    expect(filterClips(clips, 'kiss emotion').map((c) => c.name)).toEqual(['emotion_kiss_a']);
    expect(filterClips(clips, 'emotion_cry').map((c) => c.name)).toEqual(['emotion_cry_a']);
    expect(filterClips(clips, 'run 024').map((c) => c.name)).toEqual(['ride_run_024']);
    expect(filterClips(clips, 'nothing')).toEqual([]);
  });
});

describe('groupOf', () => {
  it('finds the group of a clip', () => {
    const groups = groupClips([...many('a', 15), ...many('b', 15)]);
    expect(groupOf(groups, 'b_03')).toBe('b');
    expect(groupOf(groups, 'missing')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats seconds compactly', () => {
    expect(formatDuration(0.84)).toBe('0.8s');
    expect(formatDuration(2.133)).toBe('2.1s');
    expect(formatDuration(9.96)).toBe('10s');
    expect(formatDuration(12.4)).toBe('12s');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('is empty when unknown', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(NaN)).toBe('');
  });
});
