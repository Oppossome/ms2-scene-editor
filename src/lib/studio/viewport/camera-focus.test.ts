import { beforeEach, describe, expect, it } from 'vitest';
import { CameraFocus } from './camera-focus.js';

let focus: CameraFocus;
const main = Symbol('main');
const toolbox = Symbol('toolbox');
const clips = Symbol('clips');

const active = () => [focus.isActive(main, true), focus.isActive(toolbox, false), focus.isActive(clips, false)];

beforeEach(() => {
  focus = new CameraFocus();
});

describe('camera keyboard focus', () => {
  it('defaults to the main viewport when the pointer is outside all views', () => {
    expect(active()).toEqual([true, false, false]);
  });

  it('routes movement exclusively to a hovered preview', () => {
    focus.enter(toolbox);
    expect(active()).toEqual([false, true, false]);
    focus.enter(clips);
    expect(active()).toEqual([false, false, true]);
  });

  it('routes movement back to the main viewport when it is hovered', () => {
    focus.enter(toolbox);
    focus.enter(main);
    expect(active()).toEqual([true, false, false]);
  });

  it('falls back to the main viewport after leaving or removing the hovered preview', () => {
    focus.enter(clips);
    focus.leave(clips);
    expect(active()).toEqual([true, false, false]);
  });

  it('does not clear another view when an inactive view leaves or is removed', () => {
    focus.enter(toolbox);
    focus.enter(clips);
    focus.leave(toolbox);
    focus.leave(main);
    expect(active()).toEqual([false, false, true]);
  });
});
