import type { MenuItem, Studio } from './controller.svelte.js';

/** What the Help menu offers. */
export function helpMenuItems(studio: Pick<Studio, 'showAbout' | 'showReportIssue'>): MenuItem[] {
  return [
    { label: 'About', action: () => (studio.showAbout = true) },
    { label: 'Report an issue…', action: () => (studio.showReportIssue = true) }
  ];
}
