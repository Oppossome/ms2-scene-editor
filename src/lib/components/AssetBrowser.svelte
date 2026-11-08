<script lang="ts" generics="T extends { id: string; name: string }">
  interface Props {
    /** API endpoint returning { total, items } for ?q=&offset=&limit= */
    endpoint: string;
    placeholder?: string;
    selectedId?: string | null;
    onpick: (record: T) => void;
    /** Optional extra detail line per record. */
    detail?: (record: T) => string;
  }

  let { endpoint, placeholder = 'Search...', selectedId = null, onpick, detail }: Props = $props();

  const PAGE = 60;
  let query = $state('');
  let records = $state<T[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let token = 0;

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
  <ul>
    {#each records as record (record.id)}
      <li>
        <button class:selected={record.id === selectedId} onclick={() => onpick(record)}>
          <span class="name">{record.name}</span>
          <span class="detail">{detail ? detail(record) : record.id}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if records.length < total}
    <button class="more" disabled={loading} onclick={() => fetchPage(false)}>
      {loading ? 'Loading...' : 'Load more'}
    </button>
  {/if}
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
    flex-direction: column;
    padding: 5px 6px;
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
