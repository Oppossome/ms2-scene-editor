import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, type ViewSettings } from '../scene/environment';
import { viewMenuItems } from './viewmenu';

const studio = (look: Partial<ViewSettings> = {}, showGrid = true) => ({
  showGrid,
  look: { ...DEFAULT_VIEW, ...look },
  pickingBackdrop: false
});
const item = (s: ReturnType<typeof studio>, label: RegExp) => viewMenuItems(s).find((i) => label.test(i.label))!;

describe('viewMenuItems', () => {
  it('offers the grid as a switch that shows its current state', () => {
    expect(item(studio(), /^Grid$/).checked).toBe(true);
    expect(item(studio({}, false), /^Grid$/).checked).toBe(false);
  });

  it('turns the grid off and on again', () => {
    const s = studio();
    item(s, /^Grid$/).action();
    expect(s.showGrid).toBe(false);
    item(s, /^Grid$/).action();
    expect(s.showGrid).toBe(true);
  });

  it('switches fog', () => {
    const s = studio();
    expect(item(s, /^Fog$/).checked).toBe(true);
    item(s, /^Fog$/).action();
    expect(s.look.fog).toBe(false);
    expect(item(s, /^Fog$/).checked).toBe(false);
  });

  it('marks the backdrop source in use and changes it', () => {
    const s = studio();
    expect(item(s, /Map backdrop/).checked).toBe(true);
    expect(item(s, /No backdrop/).checked).toBe(false);
    item(s, /No backdrop/).action();
    expect(s.look.background).toBe('none');
    item(s, /Map backdrop/).action();
    expect(s.look.background).toBe('map');
  });

  it('opens the picker, and names the chosen image', () => {
    const s = studio();
    item(s, /Choose backdrop/).action();
    expect(s.pickingBackdrop).toBe(true);
    const chosen = studio({ background: 'image', image: 'bg_cave_c' });
    expect(item(chosen, /Backdrop: bg_cave_c/).checked).toBe(true);
  });
});
