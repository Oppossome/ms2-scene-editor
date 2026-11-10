import { describe, expect, it } from 'vitest';
import { GroupEntity } from './group.svelte.js';
import { controlContext, controlRow } from './testing.js';

describe('GroupEntity', () => {
  it('is a plain group saved with its provenance', () => {
    const group = new GroupEntity();
    group.set({ mapId: '1' });
    expect(group).toBeInstanceOf(GroupEntity);
    expect(group.toJSON()).toMatchObject({ type: 'group', mapId: '1' });
    expect(controlRow(controlContext(group), 'mapId')).toMatchObject({
      type: 'readonly',
      section: 'Source',
      value: '1'
    });
  });
});
