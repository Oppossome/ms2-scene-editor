import { describe, expect, it } from 'vitest';
import { viewMenuItems } from './viewmenu';

describe('viewMenuItems', () => {
  it('offers the grid as a switch that shows its current state', () => {
    const view = { showGrid: true };
    const [grid] = viewMenuItems(view);
    expect(grid).toMatchObject({ label: 'Grid', checked: true });
    expect(viewMenuItems({ showGrid: false })[0].checked).toBe(false);
  });

  it('turns the grid off and on again', () => {
    const view = { showGrid: true };
    viewMenuItems(view)[0].action();
    expect(view.showGrid).toBe(false);
    viewMenuItems(view)[0].action();
    expect(view.showGrid).toBe(true);
  });
});
