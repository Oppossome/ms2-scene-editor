<script lang="ts">
  import { tick } from 'svelte';
  import type { BoneInfo } from '#lib/character/rig.js';
  import type { SceneNode } from '#lib/scene/model.js';
  import { ancestorsOf, canParent } from '#lib/scene/tree.js';
  import type { Studio } from './controller.svelte.js';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);
  const runtime = $derived(studio.runtime);

  type Zone = 'before' | 'into' | 'after';
  type Row =
    | { type: 'node'; key: string; depth: number; node: SceneNode; expandable: boolean; open: boolean }
    | { type: 'skeleton'; key: string; depth: number; character: SceneNode; open: boolean }
    | { type: 'bone'; key: string; depth: number; characterId: string; bone: BoneInfo; open: boolean };

  const BADGES: Record<SceneNode['kind'], string> = { group: 'G', prop: 'P', npc: 'N', character: 'C', item: 'I', map: 'M' };

  let filter = $state('');
  let list = $state<HTMLDivElement>();

  const rows = $derived.by<Row[]>(() => {
    void runtime.version;
    const q = filter.trim().toLowerCase();
    const nodes = store.nodes;
    const byParent = new Map<string | null, SceneNode[]>();
    for (const n of nodes) {
      const l = byParent.get(n.parentId) ?? [];
      l.push(n);
      byParent.set(n.parentId, l);
    }
    // While filtering, keep matches and the ancestors that lead to them.
    let keep: Set<string> | null = null;
    if (q) {
      keep = new Set();
      for (const n of nodes) {
        if (!n.name.toLowerCase().includes(q)) continue;
        keep.add(n.id);
        for (const a of ancestorsOf(nodes, n.id)) keep.add(a.id);
      }
    }
    const out: Row[] = [];
    const walkBones = (characterId: string, bones: BoneInfo[], depth: number) => {
      for (const bone of bones) {
        const key = `bone:${characterId}:${bone.name}`;
        const open = !!store.expanded[key];
        out.push({ type: 'bone', key, depth, characterId, bone, open });
        if (open) walkBones(characterId, bone.children, depth + 1);
      }
    };
    const walk = (parentId: string | null, depth: number) => {
      for (const node of byParent.get(parentId) ?? []) {
        if (keep && !keep.has(node.id)) continue;
        const kids = byParent.get(node.id) ?? [];
        const isCharacter = node.kind === 'character';
        const open = keep ? true : !!store.expanded[node.id];
        out.push({ type: 'node', key: node.id, depth, node, expandable: kids.length > 0 || isCharacter, open });
        if (!open) continue;
        if (isCharacter && !keep) {
          const key = `skel:${node.id}`;
          const skelOpen = !!store.expanded[key];
          out.push({ type: 'skeleton', key, depth: depth + 1, character: node, open: skelOpen });
          if (skelOpen) walkBones(node.id, runtime.boneTree(node.id), depth + 2);
        }
        walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  // Reveal the selected node: open its ancestors and scroll it into view.
  $effect(() => {
    const id = store.selectedId;
    if (!id) return;
    for (const a of ancestorsOf(store.nodes, id)) store.setExpanded(a.id, true);
    void tick().then(() => list?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' }));
  });

  const isSelected = (row: Row) =>
    row.type === 'node'
      ? store.selectedId === row.node.id
      : row.type === 'bone'
        ? store.selectedBone?.characterId === row.characterId && store.selectedBone.bone === row.bone.name
        : false;

  function onRowClick(row: Row) {
    if (row.type === 'node') store.select(row.node.id);
    else if (row.type === 'bone') store.selectBone(row.characterId, row.bone.name);
    else store.toggle(row.key);
  }

  function onContext(e: MouseEvent, row: Row) {
    e.preventDefault();
    if (row.type === 'node') {
      store.select(row.node.id);
      studio.openMenu(e.clientX, e.clientY, { type: 'node', id: row.node.id });
    } else if (row.type === 'bone') {
      store.selectBone(row.characterId, row.bone.name);
      studio.openMenu(e.clientX, e.clientY, { type: 'bone', characterId: row.characterId, bone: row.bone.name });
    } else {
      store.select(row.character.id);
      studio.openMenu(e.clientX, e.clientY, { type: 'node', id: row.character.id });
    }
  }

  // ----- rename -----

  function focusOnMount(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  function finishRename(id: string, value: string | null) {
    if (studio.renaming !== id) return;
    studio.renaming = null;
    if (value !== null) store.rename(id, value);
  }

  // ----- drag and drop -----

  let dragId = $state<string | null>(null);
  let hint = $state<{ key: string; zone: Zone } | null>(null);

  function zoneOf(e: DragEvent, expandable: boolean): Zone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (f < 0.25) return 'before';
    if (f > 0.75 && !(expandable && store.expanded[(e.currentTarget as HTMLElement).dataset.key ?? ''])) return 'after';
    return 'into';
  }

  function dropTarget(row: Row, zone: Zone): { parentId: string | null; beforeId: string | null; bone?: string } | null {
    if (!dragId) return null;
    if (row.type === 'bone') {
      return canParent(store.nodes, dragId, row.characterId) ? { parentId: row.characterId, beforeId: null, bone: row.bone.name } : null;
    }
    if (row.type === 'skeleton') return null;
    const node = row.node;
    if (zone === 'into') return canParent(store.nodes, dragId, node.id) ? { parentId: node.id, beforeId: null } : null;
    if (node.id === dragId || !canParent(store.nodes, dragId, node.parentId)) return null;
    let beforeId: string | null = node.id;
    if (zone === 'after') {
      const siblings = store.nodes.filter((n) => n.parentId === node.parentId);
      beforeId = siblings[siblings.findIndex((n) => n.id === node.id) + 1]?.id ?? null;
    }
    return { parentId: node.parentId, beforeId };
  }

  function onDragOver(e: DragEvent, row: Row) {
    if (!dragId) return;
    const zone = row.type === 'node' ? zoneOf(e, row.expandable) : 'into';
    if (!dropTarget(row, zone)) {
      hint = null;
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (hint?.key !== row.key || hint.zone !== zone) hint = { key: row.key, zone };
  }

  function onDrop(e: DragEvent, row: Row) {
    e.preventDefault();
    const zone = row.type === 'node' ? zoneOf(e, row.expandable) : 'into';
    const target = dropTarget(row, zone);
    const id = dragId;
    dragId = null;
    hint = null;
    if (!target || !id) return;
    store.reparent(id, target.parentId, { beforeId: target.beforeId, bone: target.bone });
  }

  function onDragEnd() {
    dragId = null;
    hint = null;
  }

  const css = (n: string) => n.replace(/_/g, ' ');
</script>

<div class="explorer">
  <div class="bar">
    <input type="search" placeholder="Filter..." bind:value={filter} />
    <button title="Collapse all" onclick={() => (store.expanded = {})}>-</button>
  </div>
  <div class="list" bind:this={list} role="tree">
    {#each rows as row (row.key)}
      {@const node = row.type === 'node' ? row.node : null}
      <div
        class="row {row.type}"
        class:selected={isSelected(row)}
        class:hidden={node && !node.visible}
        class:drop-into={hint?.key === row.key && hint.zone === 'into'}
        class:drop-before={hint?.key === row.key && hint.zone === 'before'}
        class:drop-after={hint?.key === row.key && hint.zone === 'after'}
        class:dragging={node && node.id === dragId}
        style:padding-left={`${6 + row.depth * 14}px`}
        data-key={row.key}
        role="treeitem"
        aria-selected={isSelected(row)}
        tabindex="-1"
        draggable={node ? 'true' : 'false'}
        onclick={() => onRowClick(row)}
        ondblclick={() => node && (studio.renaming = node.id)}
        onkeydown={(e) => e.key === 'Enter' && onRowClick(row)}
        oncontextmenu={(e) => onContext(e, row)}
        ondragstart={(e) => {
          if (!node) return e.preventDefault();
          dragId = node.id;
          e.dataTransfer?.setData('text/plain', node.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
        ondragover={(e) => onDragOver(e, row)}
        ondrop={(e) => onDrop(e, row)}
        ondragend={onDragEnd}
      >
        {#if row.type === 'node'}
          <button
            class="chev"
            class:none={!row.expandable}
            onclick={(e) => {
              e.stopPropagation();
              store.toggle(row.node.id);
            }}
            tabindex="-1"
            aria-label="Expand">{row.open ? '▾' : '▸'}</button
          >
          <span class="badge k-{row.node.kind}">{BADGES[row.node.kind]}</span>
          {#if studio.renaming === row.node.id}
            <input
              class="rename"
              value={row.node.name}
              use:focusOnMount
              onclick={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finishRename(row.node.id, e.currentTarget.value);
                else if (e.key === 'Escape') finishRename(row.node.id, null);
              }}
              onblur={(e) => finishRename(row.node.id, e.currentTarget.value)}
            />
          {:else}
            <span class="name" title={row.node.name}>{row.node.name}</span>
          {/if}
          <span class="tools">
            <button
              class:off={row.node.locked}
              title={row.node.locked ? 'Unlock' : 'Lock'}
              tabindex="-1"
              onclick={(e) => {
                e.stopPropagation();
                studio.toggleLocked(row.node.id);
              }}>{row.node.locked ? '🔒' : '🔓'}</button
            >
            <button
              class:off={!row.node.visible}
              title={row.node.visible ? 'Hide' : 'Show'}
              tabindex="-1"
              onclick={(e) => {
                e.stopPropagation();
                studio.toggleVisible(row.node.id);
              }}>{row.node.visible ? '👁' : '—'}</button
            >
          </span>
        {:else if row.type === 'skeleton'}
          <button class="chev" tabindex="-1" aria-label="Expand">{row.open ? '▾' : '▸'}</button>
          <span class="badge k-skeleton">S</span>
          <span class="name muted">Skeleton</span>
        {:else}
          <button
            class="chev"
            class:none={row.bone.children.length === 0}
            tabindex="-1"
            aria-label="Expand"
            onclick={(e) => {
              e.stopPropagation();
              store.toggle(row.key);
            }}>{row.open ? '▾' : '▸'}</button
          >
          <span class="badge k-bone">B</span>
          <span class="name" title={row.bone.name}>{css(row.bone.name)}</span>
        {/if}
      </div>
    {:else}
      <p class="empty">{filter ? 'No matches.' : 'The scene is empty. Add things from the Toolbox, or right-click here.'}</p>
    {/each}
    <div
      class="rest"
      role="presentation"
      oncontextmenu={(e) => {
        e.preventDefault();
        studio.openMenu(e.clientX, e.clientY, { type: 'empty' });
      }}
      ondragover={(e) => {
        if (dragId && canParent(store.nodes, dragId, null)) {
          e.preventDefault();
          hint = { key: '', zone: 'into' };
        }
      }}
      ondrop={(e) => {
        e.preventDefault();
        const id = dragId;
        dragId = null;
        hint = null;
        if (id) store.reparent(id, null);
      }}
      onclick={() => store.select(null)}
    ></div>
  </div>
</div>

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .bar {
    display: flex;
    gap: 4px;
    padding: 6px;
  }
  .bar input {
    flex: 1;
    min-width: 0;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    font-size: 12.5px;
    display: flex;
    flex-direction: column;
  }
  .rest {
    flex: 1;
    min-height: 24px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    flex: none;
    padding-right: 4px;
    cursor: default;
    position: relative;
    white-space: nowrap;
  }
  .row:hover {
    background: #262a3b;
  }
  .row.selected {
    background: #2d3f7a;
  }
  .row.hidden .name {
    opacity: 0.45;
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-into {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
    background: #2a3563;
  }
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
  }
  .row.drop-before::before {
    top: 0;
  }
  .row.drop-after::after {
    bottom: 0;
  }
  .chev {
    width: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    line-height: 1;
    flex: none;
  }
  .chev.none {
    visibility: hidden;
  }
  .badge {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #10121a;
    background: #8892b0;
  }
  .k-group {
    background: #c9b458;
  }
  .k-prop {
    background: #6cc3a0;
  }
  .k-npc {
    background: #e59a64;
  }
  .k-character {
    background: #7aa2ff;
  }
  .k-item {
    background: #c78cf0;
  }
  .k-map {
    background: #6cb4e0;
  }
  .k-skeleton,
  .k-bone {
    background: #5b6280;
    color: #d0d4e6;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .muted {
    color: var(--muted);
    font-style: italic;
  }
  .rename {
    flex: 1;
    min-width: 0;
    padding: 0 4px;
    height: 20px;
  }
  .tools {
    display: inline-flex;
    gap: 2px;
    flex: none;
  }
  .tools button {
    padding: 0 3px;
    border: none;
    background: transparent;
    font-size: 11px;
    line-height: 1;
    opacity: 0;
  }
  /* Locked and hidden nodes keep their indicator; the rest only show on hover. */
  .tools button.off,
  .row:hover .tools button,
  .row.selected .tools button {
    opacity: 1;
  }
  .empty {
    color: var(--muted);
    font-size: 12px;
    padding: 10px;
  }
</style>
