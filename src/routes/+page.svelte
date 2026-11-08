<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Viewport from '#lib/components/Viewport.svelte';
  import { pathOf } from '#lib/scene/tree.js';
  import ContextMenu from '#lib/studio/ContextMenu.svelte';
  import { Studio } from '#lib/studio/controller.svelte.js';
  import Explorer from '#lib/studio/Explorer.svelte';
  import BackgroundPicker from '#lib/studio/BackgroundPicker.svelte';
  import MenuBar from '#lib/studio/MenuBar.svelte';
  import { parseView } from '#lib/scene/environment.js';
  import Properties from '#lib/studio/Properties.svelte';
  import Splitter from '#lib/studio/Splitter.svelte';
  import StudioScene from '#lib/studio/StudioScene.svelte';
  import Toolbox from '#lib/studio/Toolbox.svelte';

  const studio = new Studio();
  const store = studio.store;
  const runtime = studio.runtime;

  const LAYOUT_KEY = 'ms2se.studio.layout';
  let leftWidth = $state(340);
  let rightWidth = $state(320);
  let explorerHeight = $state(280);
  let ready = $state(false);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  onMount(() => {
    if (import.meta.env.DEV) (window as unknown as { __studio: Studio }).__studio = studio;
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
      if (typeof saved.leftOpen === 'boolean') studio.toolboxOpen = saved.leftOpen;
      if (typeof saved.showGrid === 'boolean') studio.showGrid = saved.showGrid;
      studio.look = parseView(saved.look);
      if (typeof saved.leftWidth === 'number') leftWidth = clamp(saved.leftWidth, 200, 600);
      if (typeof saved.rightWidth === 'number') rightWidth = clamp(saved.rightWidth, 220, 600);
      if (typeof saved.explorerHeight === 'number') explorerHeight = clamp(saved.explorerHeight, 100, 900);
      if (typeof saved.previewHeight === 'number') studio.previewHeight = clamp(saved.previewHeight, 120, 600);
      if (saved.expanded && typeof saved.expanded === 'object') store.expanded = saved.expanded;
    } catch {
      // A damaged layout entry just means the defaults.
    }
    store.loadLocal(localStorage);
    ready = true;
  });

  onDestroy(() => studio.dispose());

  $effect(() => {
    if (!ready) return;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ leftOpen: studio.toolboxOpen, showGrid: studio.showGrid, look: studio.look, leftWidth, rightWidth, explorerHeight, previewHeight: studio.previewHeight, expanded: store.expanded }));
  });

  // Autosave on every change once the stored scene has been loaded.
  $effect(() => {
    if (!ready) return;
    void store.nodes;
    store.saveLocal(localStorage);
  });

  // The three.js graph follows the node tree.
  $effect(() => {
    runtime.sync(store.nodes);
  });

  $effect(() => {
    void runtime.version;
    runtime.setSelection(store.selectedId, store.selectedBone);
  });

  /** Step the selected animation: `,` and `.` by a frame, Shift with them by ten. */
  const FRAME_KEYS: Record<string, number> = { ',': -1, '.': 1, '<': -10, '>': 10 };

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    // Keys pressed on a list row in the Toolbox belong to the list (Delete must not remove the scene selection).
    if (el?.closest('.dock')) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const id = store.selectedId;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (mod && key === 'd' && id) {
      e.preventDefault();
      store.duplicate(id);
    } else if (mod && key === 'g' && id) {
      e.preventDefault();
      store.group(id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && id) {
      store.remove(id);
    } else if (e.key === 'F2' && id) {
      studio.renaming = id;
    } else if (!mod && key === 'g') store.mode = 'translate';
    else if (!mod && key === 'r') store.mode = 'rotate';
    else if (!mod && key === 's') store.mode = 'scale';
    else if (!mod && key === 'f') studio.focus(id);
    else if (!mod && id && FRAME_KEYS[e.key]) studio.stepFrame(id, FRAME_KEYS[e.key]);
    else if (!mod && key === 'i') {
      e.preventDefault();
      studio.openToolbox();
    }
    else if (e.key === 'Escape') store.select(null);
  }

  const status = $derived.by(() => {
    if (store.selectedBone) {
      const c = store.node(store.selectedBone.characterId);
      return `${c?.name ?? ''} / ${store.selectedBone.bone.replace(/_/g, ' ')}`;
    }
    return store.selectedId ? pathOf(store.nodes, store.selectedId).join(' / ') : 'Nothing selected';
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <MenuBar {studio} />
  <div class="studio">
    {#if studio.toolboxOpen}
      <aside class="dock" style:width={`${leftWidth}px`}>
        <Toolbox {studio} />
      </aside>
      <Splitter axis="x" onresize={(d) => (leftWidth = clamp(leftWidth + d, 200, 600))} />
    {/if}

    <section class="center">
      <div class="toolbar">
        <button class:active={studio.toolboxOpen} onclick={() => (studio.toolboxOpen = !studio.toolboxOpen)} title="Show or hide the Toolbox (I opens it)">Toolbox</button>
        <span class="sep"></span>
        <button class:active={store.mode === 'translate'} onclick={() => (store.mode = 'translate')} title="Move (G)">Move</button>
        <button class:active={store.mode === 'rotate'} onclick={() => (store.mode = 'rotate')} title="Rotate (R)">Rotate</button>
        <button class:active={store.mode === 'scale'} onclick={() => (store.mode = 'scale')} title="Scale (S)">Scale</button>
        <label class="snap"><input type="checkbox" bind:checked={store.snap} /> snap</label>
        <button onclick={() => studio.focus(store.selectedId)} disabled={!store.selectedId} title="Frame the selection (F)">Focus</button>
      </div>

      <div class="viewport">
        <Viewport viewApi={studio.view} grid={studio.showGrid} gridSize={4000} background={studio.environment.background} fog={studio.environment.fog} onTick={(d) => runtime.update(d)}>
          <StudioScene {studio} />
        </Viewport>
      </div>

      <div class="status">
        <span class="path" title={status}>{status}</span>
        {#if studio.message}<span class="msg">{studio.message}</span>{/if}
        <span class="grow"></span>
        <span>{store.nodes.length} nodes</span>
      </div>
    </section>

    <Splitter axis="x" onresize={(d) => (rightWidth = clamp(rightWidth - d, 220, 600))} />

    <aside class="right" style:width={`${rightWidth}px`}>
      <div class="pane" style:height={`${explorerHeight}px`}>
        <h3>Explorer</h3>
        <div class="pane-body"><Explorer {studio} /></div>
      </div>
      <Splitter axis="y" onresize={(d) => (explorerHeight = clamp(explorerHeight + d, 100, 900))} />
      <div class="pane fill">
        <h3>Properties</h3>
        <div class="pane-body"><Properties {studio} /></div>
      </div>
    </aside>
  </div>
</div>

{#if studio.pickingBackdrop}
  <BackgroundPicker {studio} />
{/if}

{#if studio.menu}
  {#key studio.menu}
    <ContextMenu x={studio.menu.x} y={studio.menu.y} items={studio.menuItems(studio.menu.target)} onclose={() => studio.closeMenu()} />
  {/key}
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .studio {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .dock,
  .right {
    flex: none;
    min-height: 0;
    background: var(--panel);
  }
  .dock {
    padding: 8px;
    overflow: hidden;
  }
  .right {
    display: flex;
    flex-direction: column;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: none;
  }
  .pane.fill {
    flex: 1;
    height: auto;
  }
  .pane-body {
    flex: 1;
    min-height: 0;
  }
  h3 {
    margin: 0;
    padding: 5px 8px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    background: #20233a;
    border-bottom: 1px solid var(--border);
  }
  .center {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .toolbar,
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--panel);
    flex: none;
  }
  .toolbar {
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .status {
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }
  .msg {
    color: #ffb36b;
  }
  .grow {
    flex: 1;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
  }
  .viewport {
    flex: 1;
    min-height: 0;
  }
  button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .snap {
    font-size: 12px;
    color: var(--muted);
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
</style>
