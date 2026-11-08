<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { previewUrlForModel } from '#lib/assets/urls.js';
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import ItemBrowser from '#lib/components/ItemBrowser.svelte';
  import { deleteNamed, loadSaved, type OutfitSnapshot } from '#lib/stores/outfits.js';
  import type { ChannelIndexes } from '#lib/character/tint.js';
  import { DEFAULT_EYE } from '#lib/scene/model.js';
  import { CHANNEL_LABELS, editableChannels, type PickChannel } from '#lib/scene/properties.js';
  import type { ItemRecord } from '#lib/types.js';
  import type { Studio } from './controller.svelte.js';
  import PaletteRow from './PaletteRow.svelte';
  import { PreviewController, type PreviewSource } from './preview.svelte.js';
  import PreviewStage from './PreviewStage.svelte';
  import Splitter from './Splitter.svelte';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);

  interface ModelEntry {
    id: string;
    name: string;
    glb: string;
    scale?: number;
  }
  interface MapEntry {
    id: string;
    name: string;
  }
  interface OutfitEntry {
    id: string;
    name: string;
    saved: boolean;
    snapshot: OutfitSnapshot;
  }

  type Tab = 'props' | 'npcs' | 'maps' | 'characters' | 'items';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'props', label: 'Props' },
    { id: 'npcs', label: 'NPCs' },
    { id: 'maps', label: 'Maps' },
    { id: 'characters', label: 'Characters' },
    { id: 'items', label: 'Items' }
  ];

  const tab = $derived(studio.toolboxTab);
  let selected = $state.raw<ModelEntry | MapEntry | OutfitEntry | ItemRecord | null>(null);
  let outfits = $state.raw<OutfitEntry[]>([]);
  let itemGender = $state<0 | 1>(1);
  /** Palette row chosen per item, and per-channel picks on top of it. */
  let colorChoice = $state<Record<string, number>>({});
  let channelChoice = $state<Record<string, ChannelIndexes>>({});
  let added = $state(0);
  let addedTimer: ReturnType<typeof setTimeout> | undefined;

  const preview = new PreviewController();
  onDestroy(() => {
    clearTimeout(addedTimer);
    preview.dispose();
  });

  function setTab(next: Tab) {
    studio.toolboxTab = next;
  }

  // Switching tabs (here, or by Add Child on a character) drops the selection: it belongs to the other list.
  let lastTab = untrack(() => studio.toolboxTab);
  $effect(() => {
    const current = studio.toolboxTab;
    if (current === lastTab) return;
    lastTab = current;
    selected = null;
    added = 0;
  });

  let root = $state<HTMLDivElement>();
  $effect(() => {
    if (!studio.toolboxFocus) return;
    void tick().then(() => root?.querySelector<HTMLInputElement>('input[type=search]')?.focus());
  });

  // ----- characters tab -----

  function refreshOutfits() {
    const base = (id: string, name: string, gender: 0 | 1): OutfitEntry => ({
      id,
      name,
      saved: false,
      snapshot: { version: 1, gender, skin: 2, items: [] }
    });
    outfits = [
      base('base-1', 'Female (base)', 1),
      base('base-0', 'Male (base)', 0),
      ...Object.entries(loadSaved(localStorage)).map(([name, snapshot]) => ({ id: `saved:${name}`, name, saved: true, snapshot }))
    ];
  }

  $effect(() => {
    if (tab === 'characters') untrack(refreshOutfits);
  });

  function removeOutfit(entry: OutfitEntry) {
    deleteNamed(localStorage, entry.name);
    if (selected === entry) selected = null;
    refreshOutfits();
  }

  // ----- items tab -----

  const target = $derived(studio.itemTarget);
  const itemTargetGender = $derived((target?.gender ?? itemGender) as 0 | 1);
  const worn = $derived(
    new Set(store.nodes.filter((n) => n.parentId === target?.id && n.kind === 'item' && n.itemId).map((n) => n.itemId!))
  );
  const item = $derived(tab === 'items' ? (selected as ItemRecord | null) : null);
  // The character the item is tried on: what it wears now, as a string so unrelated scene edits do not reload the preview.
  const baseKey = $derived(
    target
      ? JSON.stringify({
          skin: target.skin ?? 2,
          eye: target.eye ?? DEFAULT_EYE,
          items: store.nodes
            .filter((n) => n.parentId === target.id && n.kind === 'item' && n.itemId)
            .map((n) => ({
              id: n.itemId!,
              ...(n.color !== undefined ? { color: n.color } : {}),
              ...(n.channelColors ? { channels: n.channelColors } : {})
            }))
        })
      : ''
  );
  const into = $derived(
    tab === 'items' && target
      ? [target.name, studio.insertBone?.replace(/_/g, ' ')].filter(Boolean).join(' / ')
      : studio.insertPath
  );
  const itemColor = $derived(item ? (colorChoice[item.id] ?? item.defaultColor) : undefined);
  const itemChannels = $derived(item ? channelChoice[item.id] : undefined);
  /** Channels the game lets the player change on this item; a single one is just the colour set. */
  const editable = $derived(editableChannels(item?.channels ?? [true, true]));

  function pickSet(index: number) {
    if (!item) return;
    colorChoice = { ...colorChoice, [item.id]: index };
    // A new colour set starts over: every channel follows it again.
    const { [item.id]: _dropped, ...rest } = channelChoice;
    channelChoice = rest;
  }

  function pickChannel(channel: PickChannel, index: number) {
    if (!item) return;
    channelChoice = { ...channelChoice, [item.id]: { ...channelChoice[item.id], [`ch${channel}`]: index } };
  }

  // ----- preview -----

  const source = $derived.by<PreviewSource | null>(() => {
    const s = selected;
    if (!s) return null;
    switch (tab) {
      case 'props':
      case 'npcs': {
        const m = s as ModelEntry;
        return { kind: 'model', glb: m.glb, scale: m.scale };
      }
      case 'maps':
        return { kind: 'map', id: (s as MapEntry).id };
      case 'characters': {
        const o = (s as OutfitEntry).snapshot;
        return { kind: 'character', gender: o.gender, skin: o.skin, eye: o.eye, items: o.items };
      }
      case 'items':
        return {
          kind: 'item',
          item: s as ItemRecord,
          gender: itemTargetGender,
          color: itemColor,
          channels: itemChannels,
          base: baseKey ? JSON.parse(baseKey) : undefined
        };
    }
  });

  $effect(() => {
    const s = source;
    untrack(() => void preview.show(s));
  });

  // ----- inserting -----

  function noteAdded() {
    added++;
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => (added = 0), 5000);
  }

  async function insert() {
    const s = selected;
    if (!s) return;
    let id = '';
    switch (tab) {
      case 'props':
      case 'npcs':
        id = studio.insertModel(s as ModelEntry, tab === 'props' ? 'prop' : 'npc');
        break;
      case 'maps':
        id = studio.insertMap(s as MapEntry);
        break;
      case 'characters': {
        const o = s as OutfitEntry;
        id = await studio.insertCharacter(o.saved ? o.name : o.snapshot.gender === 1 ? 'Female' : 'Male', o.snapshot);
        break;
      }
      case 'items':
        id = studio.insertItem(s as ItemRecord, itemTargetGender, itemColor, itemChannels);
        break;
    }
    if (id) noteAdded();
  }

  function applyToTarget() {
    const o = selected as OutfitEntry | null;
    if (target && o) void studio.applyOutfit(target.id, o.snapshot);
  }

  const buttonLabel = $derived.by(() => {
    if (tab !== 'items') return 'Insert';
    if (target) return `Wear on ${target.name}`;
    return `Insert on a new ${itemTargetGender === 1 ? 'female' : 'male'} character`;
  });

  const detail = $derived.by(() => {
    const s = selected;
    if (!s) return '';
    if (tab === 'items') return (s as ItemRecord).name;
    return (s as { name: string }).name;
  });

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
</script>

<div class="toolbox" bind:this={root}>
  <div class="into" title="New things are added here">
    <span class="label">Insert into</span>
    <span class="path" title={into}>{into}</span>
    <label class="root"><input type="checkbox" bind:checked={studio.insertAtRoot} /> scene root</label>
  </div>

  <div class="tabs">
    {#each TABS as t}
      <button class:active={tab === t.id} onclick={() => setTab(t.id)}>{t.label}</button>
    {/each}
  </div>

  <div class="list">
    {#if tab === 'props' || tab === 'npcs' || tab === 'maps'}
      {#key tab}
        <AssetBrowser
          endpoint={`/api/${tab}`}
          placeholder={tab === 'props' ? 'Search props...' : tab === 'npcs' ? 'Search NPCs...' : 'Search maps...'}
          selectedId={selected?.id ?? null}
          onselect={(r: ModelEntry) => (selected = r)}
          onactivate={(r: ModelEntry) => {
            selected = r;
            void insert();
          }}
          thumb={tab === 'maps' ? undefined : (r: ModelEntry) => previewUrlForModel(r.glb)}
          detail={(r: ModelEntry & { level?: number; xblock?: string }) =>
            tab === 'npcs' && r.level ? `Lv ${r.level} - ${r.id}` : tab === 'maps' ? `${r.id} - ${r.xblock ?? ''}` : r.id}
        />
      {/key}
    {:else if tab === 'items'}
      {#if target}<p class="hint">Previewed on {target.name}, with what it wears now.</p>{/if}
      <div class="gender">
        <button class:active={itemTargetGender === 1} disabled={!!target} onclick={() => (itemGender = 1)}>Female</button>
        <button class:active={itemTargetGender === 0} disabled={!!target} onclick={() => (itemGender = 0)}>Male</button>
      </div>
      <ItemBrowser
        gender={itemTargetGender}
        wornIds={worn}
        selectedId={selected?.id ?? null}
        onselect={(r) => (selected = r)}
        onactivate={(r) => {
          selected = r;
          void insert();
        }}
      />
    {:else}
      <ul class="outfits">
        {#each outfits as outfit (outfit.id)}
          <li>
            <button
              class:selected={selected === outfit}
              onclick={() => (selected = outfit)}
              ondblclick={() => {
                selected = outfit;
                void insert();
              }}
            >
              <span class="name">{outfit.name}</span>
              <span class="detail">{outfit.snapshot.gender === 1 ? 'Female' : 'Male'}, {outfit.snapshot.items.length} items</span>
            </button>
            {#if outfit.saved}<button class="del" title="Delete this saved outfit" onclick={() => removeOutfit(outfit)}>x</button>{/if}
          </li>
        {/each}
      </ul>
      <p class="hint">Save what a character wears from its Properties and the outfit shows up here.</p>
    {/if}
  </div>

  <Splitter axis="y" onresize={(d) => (studio.previewHeight = clamp(studio.previewHeight - d, 120, 600))} />

  <div class="preview" style:height={`${studio.previewHeight}px`}>
    <PreviewStage {preview} empty={tab === 'maps' ? 'Select a map to see it.' : 'Select something to preview it.'} />
  </div>

  {#if tab === 'items' && item?.palette}
    <div class="colors">
      <div class="color-row">
        {#if editable.length > 1}<span class="color-label">Colour set</span>{/if}
        <PaletteRow palette={item.palette} value={itemColor ?? 0} onpick={pickSet} />
      </div>
      {#if editable.length > 1}
        {#each editable as channel}
          <div class="color-row">
            <span class="color-label">{CHANNEL_LABELS[channel]}</span>
            <PaletteRow
              palette={item.palette}
              {channel}
              value={itemChannels?.[`ch${channel}` as const] ?? itemColor ?? 0}
              onpick={(i) => pickChannel(channel, i)}
            />
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="actions">
    <div class="selection" title={detail}>{detail || 'Nothing selected'}</div>
    <div class="buttons">
      <button class="primary" disabled={!selected} onclick={insert}>{buttonLabel}</button>
      {#if tab === 'characters' && target && selected}
        <button onclick={applyToTarget} title={`Replace what ${target.name} wears`}>Apply to {target.name}</button>
      {/if}
    </div>
    {#if added}<div class="added">{added} added</div>{/if}
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
  .into {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .into .label {
    color: var(--muted);
    flex: none;
  }
  .into .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .root {
    flex: none;
    color: var(--muted);
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  .tabs {
    display: flex;
    gap: 3px;
  }
  .tabs button {
    flex: 1;
    min-width: 0;
    padding: 4px 2px;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button.active,
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
  }
  .list {
    flex: 1;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gender {
    display: flex;
    gap: 4px;
  }
  .gender button {
    flex: 1;
    padding: 3px;
  }
  .outfits {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .outfits li {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .outfits li > button:first-child {
    flex: 1;
    display: flex;
    flex-direction: column;
    text-align: left;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 5px 6px;
  }
  .outfits li > button.selected {
    background: var(--panel-2);
    box-shadow: inset 3px 0 var(--accent);
  }
  .outfits .del {
    border: none;
    background: transparent;
    padding: 0 8px;
  }
  .detail,
  .hint {
    color: var(--muted);
    font-size: 11px;
    margin: 0;
  }
  .preview {
    flex: none;
    min-height: 0;
  }
  .colors {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 150px;
    overflow-y: auto;
  }
  .color-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .color-label {
    font-size: 11px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .selection {
    flex-basis: 100%;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .buttons {
    display: flex;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .buttons button {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .added {
    font-size: 12px;
    color: #8fd18f;
    flex: none;
  }
</style>
