<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import type { ClipInfo } from '#lib/types.js';
  import { filterClips, formatDuration, groupClips, groupOf, type ClipGroup } from './clips.js';
  import PreviewCanvas from './PreviewCanvas.svelte';
  import { PreviewController, type PreviewSource } from './preview.svelte.js';

  interface Props {
    clips: ClipInfo[];
    /** The clip in effect (marked in the list and shown on the button). Empty for none. */
    value: string;
    /** Called when a previewed clip is applied (Apply button or Enter). '' means no animation. */
    oncommit?: (name: string) => void;
    /** What the picker's own small canvas shows; previewed clips play on it and nothing else is touched until Apply. */
    source?: PreviewSource | null;
  }

  let { clips, value, oncommit, source = null }: Props = $props();

  /** Most rows rendered at once; a long search result asks to be refined instead. */
  const MAX_ROWS = 300;

  let open = $state(false);
  let query = $state('');
  /** The clip being previewed (null: none yet, '' : "no animation"). Apply uses it. */
  let previewed = $state<string | null>(null);
  /** The clip in effect when the picker opened: marked in the list, and restored when closing without Apply. */
  let baseline = $state('');
  let expanded = $state.raw<Record<string, boolean>>({});

  let button = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();
  let list = $state<HTMLDivElement>();
  let search = $state<HTMLInputElement>();
  let place = $state({ left: 0, top: 0, maxHeight: 480 });
  let own = $state.raw<PreviewController | null>(null);

  const WIDTH = 340;

  const groups = $derived(groupClips(clips));
  const searching = $derived(query.trim().length > 0);

  type Row =
    | { type: 'none' }
    | { type: 'group'; group: ClipGroup; count: number; open: boolean }
    | { type: 'clip'; clip: ClipInfo };

  const view = $derived.by(() => {
    const rows: Row[] = [{ type: 'none' }];
    let shown = 0;
    let total = 0;
    let matched = 0;
    for (const group of groups) {
      const matches = searching ? filterClips(group.clips, query) : group.clips;
      if (matches.length === 0) continue;
      matched += matches.length;
      const grouped = group.label !== '';
      const isOpen = !grouped || searching || !!expanded[group.id];
      if (grouped) rows.push({ type: 'group', group, count: matches.length, open: isOpen });
      if (!isOpen) continue;
      total += matches.length;
      for (const clip of matches) {
        if (shown >= MAX_ROWS) break;
        rows.push({ type: 'clip', clip });
        shown++;
      }
    }
    return { rows, total, shown, matched };
  });

  /** Clip names in display order, for keyboard navigation ('' is the "no animation" row). */
  const visible = $derived(
    view.rows.flatMap((r) => (r.type === 'none' ? [''] : r.type === 'clip' ? [r.clip.name] : []))
  );

  const committedInfo = $derived(clips.find((c) => c.name === value));

  // ----- open / close -----

  async function openPicker() {
    previewed = null;
    baseline = value;
    query = '';
    const home = groupOf(groups, value);
    expanded = home ? { [home]: true } : {};
    if (source) {
      const controller = new PreviewController();
      own = controller;
      const s = source;
      void controller.show(s.kind === 'model' || s.kind === 'character' ? { ...s, clip: value || undefined } : s);
    }
    open = true;
    await tick();
    position();
    search?.focus();
    list?.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  function closePicker() {
    previewed = null;
    open = false;
    own?.dispose();
    own = null;
  }

  onDestroy(() => own?.dispose());

  function position() {
    if (!button) return;
    const r = button.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    // Prefer below the button; flip above when there is clearly more room there.
    if (below >= 360 || below >= above) place = { left, top: r.bottom + 4, maxHeight: Math.min(560, below) };
    else place = { left, top: Math.max(8, r.top - 4 - Math.min(560, above)), maxHeight: Math.min(560, above) };
  }

  // ----- choosing -----

  function select(name: string) {
    previewed = name;
    void own?.play(name);
  }

  function commit(name: string) {
    oncommit?.(name);
    closePicker();
  }

  /** A click only previews; Apply (or Enter) uses the clip. */
  function onRow(name: string) {
    select(name);
    // Keep the keyboard on the search box so arrows and Enter keep working after a click.
    search?.focus();
  }

  function move(delta: number) {
    if (visible.length === 0) return;
    // Arrow keys start from the clip in effect, so the first press moves to its neighbour.
    const at = visible.indexOf(previewed ?? baseline);
    const next = Math.min(visible.length - 1, Math.max(0, at < 0 ? (delta > 0 ? 0 : visible.length - 1) : at + delta));
    select(visible[next]);
    void tick().then(() => list?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }));
  }

  function toggleGroup(id: string) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }

  function onKey(e: KeyboardEvent) {
    // Nothing typed in the picker may reach the editor's shortcuts (Delete would remove the selected node).
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(8);
        break;
      case 'PageUp':
        e.preventDefault();
        move(-8);
        break;
      case 'Home':
        if (e.target === search && query) return;
        e.preventDefault();
        select(visible[0]);
        break;
      case 'End':
        if (e.target === search && query) return;
        e.preventDefault();
        select(visible[visible.length - 1]);
        break;
      case 'Enter':
        e.preventDefault();
        if (previewed === null) {
          if (visible.length > 1) select(visible[1]);
        } else if (previewed !== baseline) commit(previewed);
        break;
      case 'Escape':
        e.preventDefault();
        closePicker();
        button?.focus();
        break;
    }
  }

  // Typing a new search starts from a clean preview state: the old selection may no longer be listed.
  $effect(() => {
    void query;
    untrack(() => {
      if (previewed !== null && !visible.includes(previewed)) previewed = null;
    });
  });
</script>

<svelte:window
  onpointerdown={(e) => {
    if (open && !popover?.contains(e.target as Node) && !button?.contains(e.target as Node)) closePicker();
  }}
  onresize={() => open && position()}
/>

<button
  class="trigger"
  bind:this={button}
  onclick={() => (open ? closePicker() : void openPicker())}
  aria-haspopup="listbox"
  aria-expanded={open}
  title={value || 'No animation'}
>
  <span class="label">{value || '(no animation)'}</span>
  {#if committedInfo && committedInfo.duration > 0}<span class="time">{formatDuration(committedInfo.duration)}</span
    >{/if}
  <span class="chev" aria-hidden="true">▾</span>
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="popover"
    bind:this={popover}
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    style:width={`${WIDTH}px`}
    style:max-height={`${place.maxHeight}px`}
    onkeydown={onKey}
  >
    {#if own}
      <div class="stage">
        <div class="canvas"><PreviewCanvas preview={own} empty="Loading..." /></div>
        <div class="controls">
          <button onclick={() => own?.togglePlay()} disabled={!own.clip}>{own.playing ? 'Pause' : 'Play'}</button>
          <label class="loop"
            ><input type="checkbox" checked={own.loop} onchange={(e) => own?.setLoop(e.currentTarget.checked)} /> loop</label
          >
          <span class="now">{own.clip || 'no animation'}</span>
        </div>
      </div>
    {/if}

    <input
      bind:this={search}
      bind:value={query}
      class="search"
      type="search"
      placeholder={`Search ${clips.length.toLocaleString()} animations...`}
      aria-label="Search animations"
    />
    <div class="hint">Click a clip to preview it, then Apply.</div>

    <div class="list" bind:this={list} role="listbox">
      {#each view.rows as row (row.type === 'none' ? '#none' : row.type === 'group' ? `g:${row.group.id}` : `c:${row.clip.name}`)}
        {#if row.type === 'none'}
          <button
            class="row"
            class:selected={previewed === ''}
            class:current={baseline === ''}
            onclick={() => onRow('')}
            tabindex="-1"
            role="option"
            aria-selected={previewed === ''}
          >
            <span class="name muted">(no animation)</span>
          </button>
        {:else if row.type === 'group'}
          <button class="group" onclick={() => toggleGroup(row.group.id)} tabindex="-1" disabled={searching}>
            <span class="chev">{row.open ? '▾' : '▸'}</span>
            <span class="name">{row.group.label}</span>
            <span class="count">{row.count}</span>
          </button>
        {:else}
          <button
            class="row"
            class:selected={previewed === row.clip.name}
            class:current={baseline === row.clip.name}
            class:indent={groups.some((g) => g.label !== '')}
            onclick={() => onRow(row.clip.name)}
            tabindex="-1"
            role="option"
            aria-selected={previewed === row.clip.name}
            title={row.clip.name}
          >
            <span class="name">{row.clip.name}</span>
            {#if row.clip.duration > 0}<span class="time">{formatDuration(row.clip.duration)}</span>{/if}
          </button>
        {/if}
      {/each}
      {#if view.matched === 0}<div class="empty">No animation matches "{query}".</div>{/if}
      {#if view.shown < view.total}
        <div class="empty">
          Showing the first {view.shown} of {view.total.toLocaleString()}. Refine the search to see more.
        </div>
      {/if}
    </div>

    <div class="footer">
      <span class="pick" title={previewed ?? ''}>
        {#if previewed === null}Nothing selected{:else if previewed === baseline}Already in use{:else}{previewed ||
            '(no animation)'}{/if}
      </span>
      <button onclick={() => closePicker()}>Cancel</button>
      <button
        class="primary"
        disabled={previewed === null || previewed === baseline}
        onclick={() => previewed !== null && commit(previewed)}>Apply</button
      >
    </div>
  </div>
{/if}

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    text-align: left;
    padding: 3px 6px;
  }
  .trigger .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    color: var(--muted);
    font-size: 11px;
    flex: none;
  }
  .chev {
    color: var(--muted);
    flex: none;
    font-size: 11px;
  }
  .popover {
    position: fixed;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: none;
  }
  .canvas {
    height: 190px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .controls .now {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--muted);
  }
  .loop {
    color: var(--muted);
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  .search {
    width: 100%;
    flex: none;
  }
  .hint {
    font-size: 11px;
    color: var(--muted);
    flex: none;
  }
  .list {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
  }
  .row,
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    flex: none;
    text-align: left;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 4px 8px;
    font-size: 12.5px;
  }
  .row.indent {
    padding-left: 22px;
  }
  .row:hover,
  .group:hover:not(:disabled) {
    background: var(--panel-2);
  }
  .row.selected {
    background: #2d3f7a;
  }
  .row.current .name::after {
    content: ' •';
    color: var(--accent);
  }
  .group {
    background: #1f2230;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group:disabled {
    opacity: 1;
    cursor: default;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
    font-style: italic;
  }
  .count {
    flex: none;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .pick {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--muted);
  }
  .empty {
    padding: 8px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
