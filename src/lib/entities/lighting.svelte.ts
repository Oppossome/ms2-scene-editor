import { BaseEntity } from './base.svelte.js';
import { EntityProperty, type PropContext, type PropertyControl } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { environmentSchema } from '../maps/environment.js';

const title = (value: string) => value[0].toUpperCase() + value.slice(1);

/** The scene's painted backdrop and distance fog. It has no geometry. */
export class LightingEntity extends BaseEntity {
  readonly type = 'lighting';
  readonly environmentProperty = this.define('environment', new EntityProperty(environmentSchema, {}));
  get environment() { return this.environmentProperty.value; }

  render(context: RenderContext) {
    this.context = context;
    this.disposed = false;
    this.renderedRevision = this.revision;
  }

  controls(ctx: PropContext): PropertyControl[] {
    const env = this.environment;
    const fog = env.fog ?? { color: [199, 237, 255] as [number, number, number], near: 5276, far: 20000 };
    return [...super.controls(ctx), {
      key: 'background', label: 'Backdrop', section: 'Environment', type: 'backdrop', value: env.background ?? '',
      edit: (background) => ({ environment: { ...env, background: background || undefined } })
    }, {
      key: 'fog', label: 'Fog', section: 'Environment', type: 'bool', value: !!env.fog,
      edit: (enabled) => ({ environment: { ...env, fog: enabled ? fog : undefined } })
    }, ...(env.fog ? [{
      key: 'fogColor', label: 'Fog RGB', section: 'Environment', type: 'vec3' as const, value: fog.color, step: 1, min: 0, max: 255,
      edit: (color: [number, number, number]) => ({ environment: { ...env, fog: { ...fog, color } } })
    }, ...(['near', 'far'] as const).map((key): PropertyControl => ({
      key: `fog${key}`, label: title(key), section: 'Environment', type: 'number', value: fog[key], min: 0,
      edit: (value) => ({ environment: { ...env, fog: { ...fog, [key]: value } } })
    }))] : [])];
  }
}
