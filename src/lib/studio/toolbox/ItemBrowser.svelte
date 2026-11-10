<script lang="ts">
  import { iconUrl } from '#lib/assets/urls.js';
  import { moveRowFocus } from './listnav.js';
  import { nearEnd } from './nearend.js';
  import { SLOT_ORDER, slotLabel } from '#lib/entities/character/slots.js';
  import type { Gender, ItemRecord } from '#lib/types.js';

  interface Props {
    /** Gender the list is filtered for. */
    gender: Gender;
    wornIds: Set<string>;
    /** Click and arrow keys select a row; double click and Enter activate it. */
    onselect: (item: ItemRecord) => void;
    onactivate?: (item: ItemRecord) => void;
    selectedId?: string | null;
  }

  let { gender, wornIds, onselect, onactivate, selectedId = null }: Props = $props();

  /** Arrow keys move between rows and select them; Enter activates the focused row. */
  function onkeydown(e: KeyboardEvent) {
    const li = (e.target as HTMLElement).closest('li');
    const index = li ? [...li.parentElement!.children].indexOf(li) : -1;
    if (e.key === 'Enter' && items[index]) {
      e.preventDefault();
      onactivate?.(items[index]);
      return;
    }
    const button = moveRowFocus(e);
    if (!button) return;
    const moved = button.closest('li')!;
    const next = items[[...moved.parentElement!.children].indexOf(moved)];
    if (next) onselect(next);
  }

  const PAGE = 60;
  let query = $state('');
  let slot = $state('');
  let items = $state.raw<ItemRecord[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let token = 0;
  let list = $state<HTMLUListElement>();

  /** The end of the list is near: fetch the next page, unless one is on its way or the last one failed. */
  function more() {
    if (!loading && !error) void fetchPage(false);
  }

  async function fetchPage(reset: boolean) {
    const mine = ++token;
    loading = true;
    error = '';
    try {
      const offset = reset ? 0 : items.length;
      const params = new URLSearchParams({
        q: query,
        gender: String(gender),
        offset: String(offset),
        limit: String(PAGE)
      });
      if (slot) params.set('slot', slot);
      const res = await fetch(`/api/items?${params}`);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const page = (await res.json()) as { total: number; items: ItemRecord[] };
      if (mine !== token) return;
      items = reset ? page.items : [...items, ...page.items];
      total = page.total;
      if (reset) list?.scrollTo({ top: 0 });
    } catch (e) {
      if (mine === token) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading = false;
    }
  }

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    void query;
    void slot;
    void gender;
    clearTimeout(timer);
    timer = setTimeout(() => fetchPage(true), 200);
    return () => clearTimeout(timer);
  });

  function hideBroken(e: Event) {
    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  }
</script>

<div class="browser">
  <div class="filters">
    <input type="search" bind:value={query} placeholder="Search items..." />
    <select bind:value={slot}>
      <option value="">All slots</option>
      {#each SLOT_ORDER as s (s)}
        <option value={s}>{slotLabel(s)}</option>
      {/each}
    </select>
  </div>
  <div class="count">{total.toLocaleString()} items</div>
  {#if error}<div class="error">{error}</div>{/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul {onkeydown} bind:this={list}>
    {#each items as item (item.id)}
      <li>
        <button
          class:worn={wornIds.has(item.id)}
          class:selected={item.id === selectedId}
          onclick={() => onselect(item)}
          ondblclick={() => onactivate?.(item)}
          title={`${item.name} (${item.id})`}
        >
          <img src={iconUrl(item.icon)} alt="" loading="lazy" onerror={hideBroken} />
          <span class="text">
            <span class="name">{item.name}</span>
            <span class="meta">{item.slots.map(slotLabel).join(', ')} - {item.cls || 'item'}</span>
          </span>
        </button>
      </li>
    {/each}
    {#if items.length < total}
      {#if error}
        <li><button class="more" onclick={() => fetchPage(false)}>Retry</button></li>
      {:else}
        <li class="sentinel" aria-hidden="true" use:nearEnd={{ onnearend: more, state: [items.length, loading] }}>
          {loading ? 'Loading...' : ''}
        </li>
      {/if}
    {/if}
  </ul>
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
  }
  .filters {
    display: flex;
    gap: 4px;
  }
  .filters input {
    flex: 1;
    min-width: 0;
  }
  .count {
    color: var(--muted);
    font-size: 12px;
  }
  .error {
    color: #ff8080;
    font-size: 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  li button {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    text-align: left;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    padding: 4px 6px;
  }
  .sentinel {
    padding: 8px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    min-height: 1px;
  }
  li button:hover {
    background: var(--panel-2);
  }
  li button.worn {
    background: #25305a;
    box-shadow: inset 3px 0 var(--accent);
  }
  li button.selected {
    background: var(--panel-2);
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  img {
    width: 40px;
    height: 40px;
    object-fit: contain;
    background: #12131a;
    border-radius: 4px;
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--muted);
    font-size: 11px;
  }
</style>
