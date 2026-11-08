import type { MenuItem, Studio } from './controller.svelte.js';

/** What the Help menu offers. */
export function helpMenuItems(studio: Pick<Studio, 'showAbout'>): MenuItem[] {
  return [{ label: 'About', action: () => (studio.showAbout = true) }];
}
