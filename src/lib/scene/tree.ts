import { canHaveChildren, newId, type SceneNode, type Vec3 } from './model.js';

export const childrenOf = (nodes: SceneNode[], parentId: string | null) => nodes.filter((n) => n.parentId === parentId);

export function descendantsOf(nodes: SceneNode[], id: string): SceneNode[] {
  const out: SceneNode[] = [];
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
export function ancestorsOf(nodes: SceneNode[], id: string): SceneNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: SceneNode[] = [];
  let cur = byId.get(byId.get(id)?.parentId ?? '');
  while (cur && out.length <= nodes.length) {
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** The top-level ancestor of a node (the node itself when it is at the root). */
export function rootOf(nodes: SceneNode[], id: string): SceneNode | undefined {
  const chain = ancestorsOf(nodes, id);
  return chain.length ? chain[chain.length - 1] : nodes.find((n) => n.id === id);
}

/** Names from the root down to the node, e.g. `["Hero", "Sword"]`. */
export function pathOf(nodes: SceneNode[], id: string): string[] {
  const self = nodes.find((n) => n.id === id);
  if (!self) return [];
  return [...ancestorsOf(nodes, id).reverse().map((n) => n.name), self.name];
}

/**
 * Whether `id` may become a child of `parentId` (null = the root). Rules: no cycles, items only live on
 * characters, nothing lives on an item.
 */
export function canParent(nodes: SceneNode[], id: string, parentId: string | null): boolean {
  const node = nodes.find((n) => n.id === id);
  if (!node) return false;
  if (parentId === null) return node.kind !== 'item';
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent || !canHaveChildren(parent.kind)) return false;
  if (node.kind === 'item') return parent.kind === 'character';
  if (parentId === id) return false;
  return !descendantsOf(nodes, id).some((d) => d.id === parentId);
}

/**
 * Move a node under a new parent, before a sibling (or last when `beforeId` is null/undefined). Returns the
 * same array when the move is not allowed. `bone` mounts it on a bone of a character parent.
 */
export function moveNode(
  nodes: SceneNode[],
  id: string,
  parentId: string | null,
  options: { beforeId?: string | null; bone?: string } = {}
): SceneNode[] {
  if (!canParent(nodes, id, parentId)) return nodes;
  const node = nodes.find((n) => n.id === id)!;
  if (options.beforeId === id) return nodes;
  const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  const moved: SceneNode = { ...node, parentId };
  if (options.bone && parent?.kind === 'character') moved.attachBone = options.bone;
  else delete moved.attachBone;

  const rest = nodes.filter((n) => n.id !== id);
  const at = options.beforeId ? rest.findIndex((n) => n.id === options.beforeId) : -1;
  if (at < 0) return [...rest, moved];
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** Remove a node and everything below it. */
export function deleteSubtree(nodes: SceneNode[], id: string): SceneNode[] {
  const gone = new Set([id, ...descendantsOf(nodes, id).map((n) => n.id)]);
  return nodes.filter((n) => !gone.has(n.id));
}

/** Copies of a node and its descendants with fresh ids; the copy of `id` is first. */
export function cloneSubtree(nodes: SceneNode[], id: string): SceneNode[] {
  const root = nodes.find((n) => n.id === id);
  if (!root) return [];
  const members = [root, ...descendantsOf(nodes, id)];
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  members.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const ids = new Map(members.map((n) => [n.id, newId()]));
  const copies = members.map<SceneNode>((n) => ({
    ...structuredClone(n),
    id: ids.get(n.id)!,
    parentId: n.id === id ? n.parentId : (ids.get(n.parentId ?? '') ?? null)
  }));
  return [copies.find((c) => c.id === ids.get(id))!, ...copies.filter((c) => c.id !== ids.get(id))];
}

/** A name not used by a sibling under `parentId`: `Base`, `Base 2`, `Base 3`... */
export function uniqueName(nodes: SceneNode[], parentId: string | null, base: string): string {
  const taken = new Set(childrenOf(nodes, parentId).map((n) => n.name));
  if (!taken.has(base)) return base;
  const stem = base.replace(/ \d+$/, '');
  for (let i = 2; ; i++) {
    const name = `${stem} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Nodes in display order (depth first, siblings in array order) with their depth. */
export function flatten(nodes: SceneNode[], isOpen: (id: string) => boolean = () => true): { node: SceneNode; depth: number }[] {
  const byParent = new Map<string | null, SceneNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const out: { node: SceneNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      out.push({ node, depth });
      if (isOpen(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export const sameVec = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
