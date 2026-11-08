<script lang="ts">
  import { onDestroy } from 'svelte';
  import { previewUrlForModel } from '#lib/assets/urls.js';
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import ItemBrowser from '#lib/components/ItemBrowser.svelte';
  import { loadSaved, type OutfitSnapshot } from '#lib/stores/outfits.js';
  import type { ItemRecord } from '#lib/types.js';
  import type { Studio } from './controller.svelte.js';
  import PaletteRow from './PaletteRow.svelte';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);
  const runtime = $derived(studio.runtime);

  interface Entry {
    id: string;
    name: string;
    glb: string;
    scale?: number;
  }

  const target = $derived(studio.addTarget);
  const node = $derived(store.node(target?.nodeId));
  const isCharacter = $derived(node?.kind === 'character');
  const gender = $derived((node?.gender ?? 1) as 0 | 1);

  let tab = $state<'items' | 'props' | 'npcs' | 'characters'>('items');
  $effect(() => {
    if (!isCharacter && tab === 'items') tab = 'props';
  });

  // Close when the node it was opened for disappears.
  $effect(() => {
    if (target && !node) studio.closeAddChild();
  });

  const wornIds = $derived(
    new Set(store.nodes.filter((n) => n.parentId === node?.id && n.kind === 'item' && n.itemId).map((n) => n.itemId!))
  );

  // ----- live preview -----

  let focused = $state.raw<ItemRecord | null>(null);
  let colorChoice = $state<Record<string, number>>({});
  let timer: ReturnType<typeof setTimeout> | undefined;

  const chosenColor = (item: ItemRecord) => wornNode(item)?.color ?? colorChoice[item.id] ?? item.defaultColor;

  /** Previews are debounced so sweeping the mouse over a list does not load every model on the way. */
  function schedule(run: () => void) {
    clearTimeout(timer);
    timer = setTimeout(run, 70);
  }

  /** The child node that makes the character wear an item, if it does. */
  const wornNode = (item: ItemRecord) => store.nodes.find((n) => n.parentId === target?.nodeId && n.itemId === item.id);

  function previewItem(item: ItemRecord) {
    focused = item;
    if (!target) return;
    // A worn item is already on show; previewing it would only cover itself.
    if (wornNode(item)) {
      clearTimeout(timer);
      runtime.clearItemPreview(target.nodeId);
      return;
    }
    schedule(() => void runtime.previewItem(target.nodeId, item, chosenColor(item)));
  }

  function pickColor(item: ItemRecord, index: number) {
    colorChoice = { ...colorChoice, [item.id]: index };
    const worn = wornNode(item);
    if (worn) store.update(worn.id, { color: index });
    else previewItem(item);
  }

  function previewModel(entry: Entry) {
    if (target) schedule(() => void runtime.previewModel(target.nodeId, entry.glb, target.bone));
  }

  function clearPreviews() {
    clearTimeout(timer);
    runtime.clearItemPreview();
    runtime.clearGhost();
  }

  onDestroy(clearPreviews);

  // ----- committing -----

  function pickItem(item: ItemRecord) {
    if (!target) return;
    clearTimeout(timer);
    runtime.clearItemPreview(target.nodeId);
    const worn = wornNode(item);
    if (worn) {
      store.remove(worn.id);
      return;
    }
    studio.commitItem(target, item, colorChoice[item.id]);
  }

  function pickModel(entry: Entry, kind: 'prop' | 'npc') {
    if (!target) return;
    clearTimeout(timer);
    runtime.clearGhost();
    studio.addModel(entry, kind, { parentId: target.nodeId, bone: target.bone });
  }

  let outfits = $state<{ name: string; snapshot: OutfitSnapshot }[]>([]);
  $effect(() => {
    if (tab === 'characters') outfits = Object.entries(loadSaved(localStorage)).map(([name, snapshot]) => ({ name, snapshot }));
  });

  const title = $derived(node ? (target?.bone ? `${node.name} / ${target.bone.replace(/_/g, ' ')}` : node.name) : '');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !(e.target as HTMLElement)?.closest('input,select,textarea') && studio.closeAddChild()} />

{#if node}
  <div class="panel" role="presentation" onmouseleave={clearPreviews}>
    <div class="head">
      <div class="title">
        <strong>Add child</strong>
        <span class="to" title={title}>to {title}</span>
      </div>
      <button onclick={() => studio.closeAddChild()} title="Close (Esc)">Done</button>
    </div>
    <p class="hint">
      {#if tab === 'items'}Hover or use the arrow keys to preview on the character, click to wear, click again to take off.{:else}Hover to preview, click to add.{/if}
    </p>
    <div class="tabs">
      {#if isCharacter}<button class:active={tab === 'items'} onclick={() => (tab = 'items')}>Items</button>{/if}
      <button class:active={tab === 'props'} onclick={() => (tab = 'props')}>Props</button>
      <button class:active={tab === 'npcs'} onclick={() => (tab = 'npcs')}>NPCs</button>
      <button class:active={tab === 'characters'} onclick={() => (tab = 'characters')}>Characters</button>
    </div>

    <div class="body">
      {#if tab === 'items' && isCharacter}
        <ItemBrowser {gender} {wornIds} onpick={pickItem} onpreview={previewItem} />
      {:else if tab === 'props'}
        {#key 'props'}
          <AssetBrowser endpoint="/api/props" placeholder="Search props..." onpick={(e: Entry) => pickModel(e, 'prop')} onpreview={previewModel} thumb={(e: Entry) => previewUrlForModel(e.glb)} />
        {/key}
      {:else if tab === 'npcs'}
        {#key 'npcs'}
          <AssetBrowser endpoint="/api/npcs" placeholder="Search NPCs..." onpick={(e: Entry) => pickModel(e, 'npc')} onpreview={previewModel} thumb={(e: Entry) => previewUrlForModel(e.glb)} />
        {/key}
      {:else if tab === 'characters'}
        <div class="list">
          <button onclick={() => studio.addBaseCharacter(1, node.id)}>Female character</button>
          <button onclick={() => studio.addBaseCharacter(0, node.id)}>Male character</button>
          <button onclick={() => studio.addGroup(node.id)}>Empty group</button>
          {#if outfits.length}<h4>Saved outfits</h4>{/if}
          {#each outfits as outfit}
            <button onclick={() => studio.addCharacter(outfit.name, outfit.snapshot, node.id)}>
              {outfit.name}
              <span class="detail">{outfit.snapshot.gender === 1 ? 'Female' : 'Male'}, {outfit.snapshot.items.length} items</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if tab === 'items' && focused?.palette}
      <div class="colors">
        <span class="detail" title={focused.name}>Colour for {focused.name}</span>
        <PaletteRow palette={focused.palette} value={chosenColor(focused)} onpick={(i) => pickColor(focused!, i)} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .title {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .to {
    color: var(--muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    flex: 1;
    padding: 4px;
  }
  .tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    height: 100%;
  }
  .list button {
    text-align: left;
    display: flex;
    flex-direction: column;
  }
  h4 {
    margin: 8px 0 2px;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
  }
  .detail {
    color: var(--muted);
    font-size: 11px;
  }
  .colors {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
</style>
