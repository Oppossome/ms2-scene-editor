import { describe, expect, it } from 'vitest';
import { helpMenuItems } from './helpmenu';

describe('helpMenuItems', () => {
  it('offers About, which opens the About dialog', () => {
    const studio = { showAbout: false };
    const [about, ...rest] = helpMenuItems(studio);
    expect(rest).toHaveLength(0);
    expect(about.label).toBe('About');
    expect(about.checked).toBeUndefined();
    about.action();
    expect(studio.showAbout).toBe(true);
  });
});
