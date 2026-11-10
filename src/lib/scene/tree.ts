import { canHaveChildren, newId } from '../entities/constants.js';
import { restoreEntity } from '../entities/registry.js';
import type { Entity } from '../entities/types.js';

const childrenOf = (nodes: Entity[], parentId: string | null) => nodes.filter((n) => n.parentId === parentId);

export function descendantsOf(nodes: Entity[], id: string): Entity[] {
  const out: Entity[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/** Ancestors from the parent up to the root. */
export function ancestorsOf(nodes: Entity[], id: string): Entity[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Entity[] = [];
  let cur = byId.get(byId.get(id)?.parentId ?? '');
  while (cur && out.length <= nodes.length) {
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** The top-level ancestor of a node (the node itself when it is at the root). */
export function rootOf(nodes: Entity[], id: string): Entity | undefined {
  const chain = ancestorsOf(nodes, id);
  return chain.length ? chain[chain.length - 1] : nodes.find((n) => n.id === id);
}

/** Names from the root down to the node, e.g. `["Hero", "Sword"]`. */
export function pathOf(nodes: Entity[], id: string): string[] {
  const self = nodes.find((n) => n.id === id);
  if (!self) return [];
  return [
    ...ancestorsOf(nodes, id)
      .reverse()
      .map((n) => n.name),
    self.name
  ];
}

/**
 * Whether `id` may become a child of `parentId` (null = the root). Rules: no cycles, items only live on
 * characters, nothing lives on an item or a Lighting entity.
 */
export function canParent(nodes: Entity[], id: string, parentId: string | null): boolean {
  const node = nodes.find((n) => n.id === id);
  if (!node) return false;
  if (parentId === null) return node.type !== 'item';
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent || !canHaveChildren(parent.type)) return false;
  if (node.type === 'item') return parent.type === 'character';
  if (parentId === id) return false;
  return !descendantsOf(nodes, id).some((d) => d.id === parentId);
}

/** Remove a node and everything below it. */
export function deleteSubtree(nodes: Entity[], id: string): Entity[] {
  const gone = new Set([id, ...descendantsOf(nodes, id).map((n) => n.id)]);
  return nodes.filter((n) => !gone.has(n.id));
}

/** Copies of a node and its descendants with fresh ids; the copy of `id` is first. */
export function cloneSubtree(nodes: Entity[], id: string): Entity[] {
  const root = nodes.find((n) => n.id === id);
  if (!root) return [];
  const members = [root, ...descendantsOf(nodes, id)];
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  members.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const ids = new Map(members.map((n) => [n.id, newId()]));
  const copies = members.map((n) =>
    restoreEntity({
      ...n.toJSON(),
      id: ids.get(n.id),
      parentId: n.id === id ? n.parentId : (ids.get(n.parentId ?? '') ?? null)
    })
  );
  return [copies.find((c) => c.id === ids.get(id))!, ...copies.filter((c) => c.id !== ids.get(id))];
}

/** A name not used by a sibling under `parentId`: `Base`, `Base 2`, `Base 3`... */
export function uniqueName(nodes: Entity[], parentId: string | null, base: string): string {
  const taken = new Set(childrenOf(nodes, parentId).map((n) => n.name));
  if (!taken.has(base)) return base;
  const stem = base.replace(/ \d+$/, '');
  for (let i = 2; ; i++) {
    const name = `${stem} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Nodes in display order (depth first, siblings in array order) with their depth. */
export function flatten(
  nodes: Entity[],
  isOpen: (id: string) => boolean = () => true
): { node: Entity; depth: number }[] {
  const byParent = new Map<string | null, Entity[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const out: { node: Entity; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      out.push({ node, depth });
      if (isOpen(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
