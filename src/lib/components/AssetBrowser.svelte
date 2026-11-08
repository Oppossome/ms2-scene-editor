<script lang="ts" generics="T extends { id: string; name: string }">
  import { hideImage, moveRowFocus } from './listnav.js';
  import { nearEnd } from './nearend.js';

  interface Props {
    /** API endpoint returning { total, items } for ?q=&offset=&limit= */
    endpoint: string;
    placeholder?: string;
    selectedId?: string | null;
    /** Click and arrow keys select a row; double click and Enter activate it. */
    onselect: (record: T) => void;
    onactivate?: (record: T) => void;
    /** Thumbnail URL for a record, or an empty string for none. Failed images are hidden. */
    thumb?: (record: T) => string;
    /** Optional extra detail line per record. */
    detail?: (record: T) => string;
  }

  let { endpoint, placeholder = 'Search...', selectedId = null, onselect, onactivate, thumb, detail }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    const li = (e.target as HTMLElement).closest('li');
    const index = li ? [...li.parentElement!.children].indexOf(li) : -1;
    if (e.key === 'Enter' && records[index]) {
      e.preventDefault();
      onactivate?.(records[index]);
      return;
    }
    const button = moveRowFocus(e);
    const moved = button?.closest('li');
    const next = moved ? records[[...moved.parentElement!.children].indexOf(moved)] : undefined;
    if (next) onselect(next);
  }

  const PAGE = 60;
  let query = $state('');
  let records = $state<T[]>([]);
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
      const offset = reset ? 0 : records.length;
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}&offset=${offset}&limit=${PAGE}`);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const page = (await res.json()) as { total: number; items: T[] };
      if (mine !== token) return;
      records = reset ? page.items : [...records, ...page.items];
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
    void endpoint;
    clearTimeout(timer);
    timer = setTimeout(() => fetchPage(true), 200);
    return () => clearTimeout(timer);
  });
</script>

<div class="browser">
  <input type="search" bind:value={query} {placeholder} />
  <div class="count">{total.toLocaleString()} results</div>
  {#if error}<div class="error">{error}</div>{/if}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul {onkeydown} bind:this={list}>
    {#each records as record (record.id)}
      {@const src = thumb?.(record)}
      <li>
        <button
          class:selected={record.id === selectedId}
          onclick={() => onselect(record)}
          ondblclick={() => onactivate?.(record)}
          title={record.name}
        >
          {#if src}<img {src} alt="" loading="lazy" onerror={hideImage} />{/if}
          <span class="text">
            <span class="name">{record.name}</span>
            <span class="detail">{detail ? detail(record) : record.id}</span>
          </span>
        </button>
      </li>
    {/each}
    {#if records.length < total}
      {#if error}
        <li><button class="more" onclick={() => fetchPage(false)}>Retry</button></li>
      {:else}
        <li class="sentinel" aria-hidden="true" use:nearEnd={{ onnearend: more, state: [records.length, loading] }}>{loading ? 'Loading...' : ''}</li>
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
  input {
    width: 100%;
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
    width: 100%;
    text-align: left;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
  }
  img {
    width: 36px;
    height: 36px;
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
  .sentinel {
    padding: 8px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    min-height: 1px;
  }
  li button:hover,
  li button.selected {
    background: var(--panel-2);
  }
  li button.selected {
    box-shadow: inset 3px 0 var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    color: var(--muted);
    font-size: 11px;
  }
</style>
