import { z } from 'zod';
import type { ClipInfo } from '../types.js';
import type { Vec3 } from './constants.js';
import type { Entity, EntityInput } from './types.js';
import type { PickChannel } from './character/appearance.js';
import { vectorSchema } from './validation.js';

export interface PropContext {
  node: Entity;
  parent?: Entity;
  clips: ClipInfo[];
  bones: string[];
  defaultBone: string;
  skinned: boolean;
  palette: number;
  channels: [main: boolean, detail: boolean];
}

interface ControlBase {
  key: string;
  label: string;
  section: string;
  disabled?: string;
}
/** An editor row. `edit` returns the property values the change stands for; the scene validates and applies them. */
export type PropertyControl =
  | (ControlBase & { type: 'string' | 'enum' | 'clip' | 'backdrop'; value: string; options?: { value: string; label: string }[]; clips?: ClipInfo[]; edit: (value: string) => EntityInput })
  | (ControlBase & { type: 'number' | 'palette'; value: number; step?: number; min?: number; max?: number; palette?: number; channel?: PickChannel; edit: (value: number) => EntityInput })
  | (ControlBase & { type: 'vec3'; value: Vec3; step?: number; min?: number; max?: number; edit: (value: Vec3) => EntityInput })
  | (ControlBase & { type: 'bool'; value: boolean; edit: (value: boolean) => EntityInput })
  | (ControlBase & { type: 'readonly'; value: string })
  | (ControlBase & { type: 'transport'; frame?: number; max?: number })
  | (ControlBase & { type: 'action'; value: string; edit: () => EntityInput });

export interface RegisteredProperty {
  readonly value: unknown;
  readonly required: boolean;
  parse(value: unknown): unknown;
  /** Store an already parsed value. */
  assign(parsed: unknown): void;
  control(ctx: PropContext): PropertyControl | null;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * One reactive, validated, serializable value of an entity. Values are immutable and only written through the
 * scene's transactions, so the same schema guards edits, saves and undo.
 */
export class EntityProperty<T> implements RegisteredProperty {
  #value: T;

  constructor(
    readonly schema: z.ZodType<T>,
    value: T,
    private readonly editor?: (value: T, ctx: PropContext) => PropertyControl | null,
    /** A saved entity without a usable value cannot be restored. */
    readonly required = false
  ) {
    this.#value = $state.raw(freeze(structuredClone(value)));
  }

  get value(): T {
    return this.#value;
  }
  parse(value: unknown): T {
    return this.schema.parse(value);
  }
  assign(parsed: unknown) {
    this.#value = freeze(parsed as T);
  }
  control(ctx: PropContext) {
    return this.editor?.(this.value, ctx) ?? null;
  }
}

export class Vector3Property extends EntityProperty<Vec3> {
  constructor(key: 'position' | 'rotation' | 'scale', value: Vec3) {
    const factor = key === 'rotation' ? 180 / Math.PI : 1;
    super(
      vectorSchema,
      value,
      (current, ctx) =>
        (ctx.node as Entity).type === 'lighting'
          ? null
          : {
              key,
              section: 'Transform',
              label: key === 'position' && ctx.node.type === 'item' ? 'Offset' : key[0].toUpperCase() + key.slice(1),
              type: 'vec3',
              value: current.map((v) => Math.round(v * factor * 1000) / 1000) as Vec3,
              step: key === 'scale' ? 0.05 : 1,
              disabled: ctx.node.type === 'item' && ctx.skinned ? 'Skinned clothes follow the skeleton' : undefined,
              edit: (next) => ({ [key]: next.map((v) => v / factor) })
            },
      true
    );
  }
}
