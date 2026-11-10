import { vi } from 'vitest';
import type { Entity } from './types.js';
import type { PropContext, PropertyControl } from './property.svelte.js';
import type { RenderContext } from './render-context.js';

export function controlContext(node: Entity, overrides: Partial<PropContext> = {}): PropContext {
  return {
    node,
    clips: [],
    bones: [],
    defaultBone: '',
    skinned: false,
    palette: 0,
    channels: [true, true],
    ...overrides
  };
}

export function controlRow(context: PropContext, key: string): PropertyControl {
  const control = context.node.controls(context).find((row) => row.key === key);
  if (!control) throw new Error(`Missing control: ${key}`);
  return control;
}

export function renderContext(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    tag: vi.fn(),
    changed: vi.fn(),
    reparent: vi.fn(),
    clips: vi.fn(),
    defaultClip: vi.fn(),
    items: () => [],
    entity: () => undefined,
    batch: () => false,
    unbatch: vi.fn(),
    error: vi.fn(),
    ...overrides
  };
}
