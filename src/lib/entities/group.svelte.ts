import { BaseEntity } from './base.svelte.js';
import { EntityProperty } from './property.svelte.js';
import { numericId } from './validation.js';

export class GroupEntity extends BaseEntity {
  readonly type = 'group';
  /** Set on groups made from a map: where their props came from (not used to regenerate them). */
  readonly sourceProperty = this.define(
    'mapId',
    new EntityProperty(numericId.optional(), undefined, (value) =>
      value
        ? {
            key: 'mapId',
            label: 'Map id',
            section: 'Source',
            type: 'readonly',
            value
          }
        : null
    )
  );
  get mapId() {
    return this.sourceProperty.value;
  }
}
