import { describe, expect, it } from 'vitest';
import { helpMenuItems } from './helpmenu';

describe('helpMenuItems', () => {
  it('offers About, which opens the About dialog', () => {
    const studio = { showAbout: false, showReportIssue: false };
    const [about] = helpMenuItems(studio);
    expect(about.label).toBe('About');
    expect(about.checked).toBeUndefined();
    about.action();
    expect(studio.showAbout).toBe(true);
    expect(studio.showReportIssue).toBe(false);
  });

  it('offers Report an issue, which opens the issue dialog', () => {
    const studio = { showAbout: false, showReportIssue: false };
    const items = helpMenuItems(studio);
    expect(items.map((i) => i.label)).toEqual(['About', 'Report an issue…']);
    items[1].action();
    expect(studio.showReportIssue).toBe(true);
    expect(studio.showAbout).toBe(false);
  });
});
