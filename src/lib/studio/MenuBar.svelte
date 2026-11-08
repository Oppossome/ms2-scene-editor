<script lang="ts">
  import ContextMenu from './ContextMenu.svelte';
  import type { MenuItem, Studio } from './controller.svelte.js';
  import { viewMenuItems } from './viewmenu.js';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);

  let fileButton = $state<HTMLButtonElement>();
  let fileInput = $state<HTMLInputElement>();
  let viewButton = $state<HTMLButtonElement>();
  let open = $state<{ which: 'file' | 'view'; x: number; y: number } | null>(null);

  /** Open a menu under its button, or close it when it is the one already open. */
  function toggle(which: 'file' | 'view', button: HTMLButtonElement | undefined) {
    if (open?.which === which) {
      open = null;
      return;
    }
    const r = button!.getBoundingClientRect();
    open = { which, x: r.left, y: r.bottom + 2 };
  }

  const fileItems = $derived<MenuItem[]>([
    { label: 'Export JSON', action: () => studio.exportJson() },
    { label: 'Import JSON...', action: () => fileInput?.click() },
    {
      label: studio.busy === 'export' ? 'Exporting GLB...' : 'Export GLB',
      action: () => void studio.exportGlb(null),
      disabled: studio.busy === 'export' || store.nodes.length === 0,
      separator: true
    },
    { label: 'Clear scene', action: () => store.clear(), disabled: store.nodes.length === 0, danger: true, separator: true }
  ]);

  const viewItems = $derived(viewMenuItems(studio));

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await studio.importJson(file);
  }
</script>

<div class="topbar">
  <span class="brand">MS2SceneEditor</span>
  <!-- Stop the pointerdown so the open menu's outside-click handler does not close it before the click toggles it. -->
  <button
    class="tab"
    class:open={open?.which === 'file'}
    bind:this={fileButton}
    onpointerdown={(e) => e.stopPropagation()}
    onclick={() => toggle('file', fileButton)}
    aria-haspopup="menu"
    aria-expanded={open?.which === 'file'}>File</button
  >
  <button
    class="tab"
    class:open={open?.which === 'view'}
    bind:this={viewButton}
    onpointerdown={(e) => e.stopPropagation()}
    onclick={() => toggle('view', viewButton)}
    aria-haspopup="menu"
    aria-expanded={open?.which === 'view'}>View</button
  >
  <span class="sep"></span>
  <button class="icon" onclick={() => store.undo()} disabled={!store.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
  </button>
  <button class="icon" onclick={() => store.redo()} disabled={!store.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
  </button>
  <input bind:this={fileInput} type="file" accept="application/json" onchange={onFile} hidden />
</div>

{#if open}
  {#key open.which}
    <ContextMenu x={open.x} y={open.y} items={open.which === 'file' ? fileItems : viewItems} onclose={() => (open = null)} />
  {/key}
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    flex: none;
    background: #151720;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    font-size: 13px;
    margin-right: 10px;
    color: #fff;
  }
  .tab {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 4px;
  }
  .tab:hover,
  .tab.open {
    background: var(--panel-2);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--border);
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 4px;
  }
  .icon:hover:not(:disabled) {
    background: var(--panel-2);
  }
  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
