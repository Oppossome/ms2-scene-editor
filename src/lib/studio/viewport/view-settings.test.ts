import { describe, expect, it } from 'vitest';
import { backdropPath, DEFAULT_VIEW, parseView, resolveEnvironment, type ViewSettings } from './view-settings';

const fog = { color: [1, 2, 3] as [number, number, number], near: 5276, far: 20000 };
const map = { background: 'Resource/Image/bg/bg_tria.png', fog };
const view = (over: Partial<ViewSettings> = {}): ViewSettings => ({ ...DEFAULT_VIEW, ...over });

describe('resolveEnvironment', () => {
  it('follows the map by default', () => {
    expect(resolveEnvironment(view(), map)).toEqual(map);
    expect(resolveEnvironment(view(), null)).toEqual({});
    expect(resolveEnvironment(view(), { fog })).toEqual({ fog });
  });

  it('shows no backdrop for "none", and the chosen image for "image"', () => {
    expect(resolveEnvironment(view({ background: 'none' }), map)).toEqual({ fog });
    expect(resolveEnvironment(view({ background: 'image', image: 'bg_cave_c' }), map).background).toBe(backdropPath('bg_cave_c'));
    expect(resolveEnvironment(view({ background: 'image', image: 'bg_cave_c' }), null).background).toBe('Resource/Image/bg/bg_cave_c.png');
    expect(resolveEnvironment(view({ background: 'image', image: null }), map).background).toBeUndefined();
  });

  it('leaves fog out when it is turned off, whatever the backdrop', () => {
    expect(resolveEnvironment(view({ fog: false }), map)).toEqual({ background: map.background });
    expect(resolveEnvironment(view({ fog: false, background: 'image', image: 'x' }), map)).toEqual({ background: backdropPath('x') });
  });
});

describe('parseView', () => {
  it('reads saved settings and falls back to the default for anything else', () => {
    expect(parseView({ background: 'image', image: 'bg_cave_c', fog: false })).toEqual({ background: 'image', image: 'bg_cave_c', fog: false });
    expect(parseView({ background: 'none' })).toEqual({ background: 'none', image: null, fog: true });
    expect(parseView(undefined)).toEqual(DEFAULT_VIEW);
    expect(parseView('x')).toEqual(DEFAULT_VIEW);
    expect(parseView({ background: 'sky' })).toEqual(DEFAULT_VIEW);
  });

  it('needs an image to use one, and only a plain file name', () => {
    expect(parseView({ background: 'image' }).background).toBe('map');
    expect(parseView({ background: 'image', image: '../../etc/passwd' })).toMatchObject({ background: 'map', image: null });
    expect(parseView({ background: 'image', image: 'bg_fairy tale' }).image).toBe('bg_fairy tale');
  });
});
