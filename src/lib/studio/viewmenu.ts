import type { MenuItem, Studio } from './controller.svelte.js';

/** What the View menu offers: switches for what the main viewport shows, and where its backdrop comes from. */
export function viewMenuItems(studio: Pick<Studio, 'showGrid' | 'look' | 'pickingBackdrop'>): MenuItem[] {
  const look = studio.look;
  return [
    { label: 'Grid', checked: studio.showGrid, action: () => (studio.showGrid = !studio.showGrid) },
    { label: 'Fog', checked: look.fog, action: () => (studio.look = { ...look, fog: !look.fog }) },
    {
      label: 'Map backdrop',
      checked: look.background === 'map',
      separator: true,
      action: () => (studio.look = { ...look, background: 'map' })
    },
    { label: 'No backdrop', checked: look.background === 'none', action: () => (studio.look = { ...look, background: 'none' }) },
    {
      label: look.image ? `Backdrop: ${look.image}...` : 'Choose backdrop...',
      checked: look.background === 'image',
      action: () => (studio.pickingBackdrop = true)
    }
  ];
}
