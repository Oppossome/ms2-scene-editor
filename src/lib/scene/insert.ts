import { CharacterEntity, type Entity } from './entity.svelte.js';
import { canHaveChildren } from './model.js';

/** Where inserted things go by default: under the selected node if it can hold children, else the scene root. */
export function defaultInsertParent(nodes: Entity[], selectedId: string | null): string | null {
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
  return selected && canHaveChildren(selected.type) ? selected.id : null;
}

/**
 * The character an inserted item should be worn by: the selected node if it is a character, otherwise the
 * nearest character up the selected node's ancestors (so a sub-item or a prop mounted on a character counts).
 * Null when there is none (the item then goes on a new character).
 */
export function itemTargetCharacter(nodes: Entity[], selectedId: string | null): CharacterEntity | null {
  let current = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current instanceof CharacterEntity) return current;
    seen.add(current.id);
    const parentId: string | null = current.parentId;
    current = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  }
  return null;
}
