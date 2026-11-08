import type { MenuItem } from './controller.svelte.js';

/** What the View dropdown of the viewport toolbar offers: one switch per thing the viewport can show. */
export function viewMenuItems(view: { showGrid: boolean }): MenuItem[] {
  return [{ label: 'Grid', checked: view.showGrid, action: () => (view.showGrid = !view.showGrid) }];
}
