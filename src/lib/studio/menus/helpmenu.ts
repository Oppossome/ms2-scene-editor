import type { MenuItem, Studio } from '../controller.svelte.js';

/** What the Help menu offers. */
export function helpMenuItems(studio: Pick<Studio, 'showAbout' | 'showKeybinds' | 'showReportIssue'>): MenuItem[] {
  return [
    { label: 'About', action: () => (studio.showAbout = true) },
    { label: 'Keybinds', action: () => (studio.showKeybinds = true) },
    { label: 'Report an issue…', action: () => (studio.showReportIssue = true) }
  ];
}
