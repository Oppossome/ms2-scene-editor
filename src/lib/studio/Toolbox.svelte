<script lang="ts">
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import { nodesToOutfit } from '#lib/scene/model.js';
  import { deleteNamed, loadSaved, type OutfitSnapshot } from '#lib/stores/outfits.js';
  import type { Studio } from './controller.svelte.js';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);

  interface Entry {
    id: string;
    name: string;
    glb: string;
    scale?: number;
  }

  let tab = $state<'props' | 'npcs' | 'maps' | 'characters'>('props');
  let outfits = $state<{ name: string; snapshot: OutfitSnapshot }[]>([]);

  function refresh() {
    outfits = Object.entries(loadSaved(localStorage)).map(([name, snapshot]) => ({ name, snapshot }));
  }

  $effect(() => {
    if (tab === 'characters') refresh();
  });

  const selectedCharacter = $derived(store.selected?.kind === 'character' ? store.selected : undefined);
</script>

<div class="toolbox">
  <div class="tabs">
    <button class:active={tab === 'props'} onclick={() => (tab = 'props')}>Props</button>
    <button class:active={tab === 'npcs'} onclick={() => (tab = 'npcs')}>NPCs</button>
    <button class:active={tab === 'maps'} onclick={() => (tab = 'maps')}>Maps</button>
    <button class:active={tab === 'characters'} onclick={() => (tab = 'characters')}>Characters</button>
  </div>

  <div class="body">
    {#if tab === 'characters'}
      <div class="list">
        <div class="inline">
          <button onclick={() => studio.addBaseCharacter(1)}>+ Female</button>
          <button onclick={() => studio.addBaseCharacter(0)}>+ Male</button>
          <button onclick={() => studio.addGroup()}>+ Group</button>
        </div>
        <p class="hint">
          Dress a character by right-clicking it and choosing Add Child. Save what it wears from its Properties and the outfit shows up here.
        </p>
        <h4>Saved outfits</h4>
        {#each outfits as outfit (outfit.name)}
          <div class="outfit">
            <span class="name" title={outfit.name}>{outfit.name}</span>
            <span class="detail">{outfit.snapshot.gender === 1 ? 'Female' : 'Male'}, {outfit.snapshot.items.length} items</span>
            <div class="inline">
              <button onclick={() => studio.addCharacter(outfit.name, outfit.snapshot)}>New</button>
              <button disabled={!selectedCharacter} onclick={() => selectedCharacter && studio.applyOutfit(selectedCharacter.id, outfit.snapshot)}>
                Apply to selected
              </button>
              <button
                title="Delete"
                onclick={() => {
                  deleteNamed(localStorage, outfit.name);
                  refresh();
                }}>x</button
              >
            </div>
          </div>
        {:else}
          <p class="hint">No saved outfits yet.</p>
        {/each}
        {#if selectedCharacter}
          <p class="hint">Selected: {selectedCharacter.name} ({nodesToOutfit(store.nodes, selectedCharacter.id)?.items.length ?? 0} items)</p>
        {/if}
      </div>
    {:else}
      {#key tab}
        <AssetBrowser
          endpoint={`/api/${tab}`}
          placeholder={tab === 'props' ? 'Search props...' : tab === 'npcs' ? 'Search NPCs...' : 'Search maps...'}
          onpick={(entry: Entry) => (tab === 'maps' ? studio.addMap(entry) : studio.addModel(entry, tab === 'props' ? 'prop' : 'npc'))}
        />
      {/key}
    {/if}
  </div>
</div>

<style>
  .toolbox {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
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
    gap: 6px;
    overflow-y: auto;
    height: 100%;
  }
  .inline {
    display: flex;
    gap: 4px;
  }
  .inline button {
    flex: 1;
  }
  .outfit {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .name {
    font-weight: 600;
  }
  .detail,
  .hint {
    color: var(--muted);
    font-size: 11px;
    margin: 0;
  }
  h4 {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
  }
</style>
