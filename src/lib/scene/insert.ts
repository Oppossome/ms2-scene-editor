import type { SceneNode } from './model.js';
import { canHaveChildren } from './model.js';

/** Where inserted things go by default: under the selected node if it can hold children, else the scene root. */
export function defaultInsertParent(nodes: SceneNode[], selectedId: string | null): string | null {
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
  return selected && canHaveChildren(selected.kind) ? selected.id : null;
}

/**
 * The character an inserted item should be worn by: the selected character, or the character that owns the
 * selected item. Null when there is none (the item then goes on a new character).
 */
export function itemTargetCharacter(nodes: SceneNode[], selectedId: string | null): SceneNode | null {
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
  if (!selected) return null;
  if (selected.kind === 'character') return selected;
  if (selected.kind === 'item') {
    const owner = nodes.find((n) => n.id === selected.parentId);
    return owner?.kind === 'character' ? owner : null;
  }
  return null;
}
