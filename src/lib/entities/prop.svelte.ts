import { z } from 'zod';
import { Group } from 'three';
import { InstanceTarget } from '../maps/entity-batches.js';
import { ModelEntity } from './model.svelte.js';
import { EntityProperty } from './property.svelte.js';
import type { RenderContext } from './render-context.js';

export class PropEntity extends ModelEntity {
  readonly type = 'prop';
  /** Placed from a map: static, drawn with the other copies of its model in one shared batch when possible. */
  readonly instanceProperty = this.define('instanced', new EntityProperty(z.boolean().optional(), undefined));
  get instanced() { return this.instanceProperty.value; }
  /** Runtime only: whether the scene's batch currently draws this prop. */
  batched = false;

  protected createObject() {
    return this.instanced ? new InstanceTarget() : new Group();
  }

  render(context: RenderContext) {
    this.renderTransform(context);
    if (this.instanced && context.batch(this)) {
      if (!this.batched) this.unloadModel();
      this.batched = true;
      return;
    }
    if (this.batched) context.unbatch(this);
    this.batched = false;
    super.render(context);
  }

  dispose() {
    this.context?.unbatch(this);
    this.batched = false;
    super.dispose();
  }
}
