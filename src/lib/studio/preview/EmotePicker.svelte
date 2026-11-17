<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { ClipInfo, EmoteRecord } from '#lib/types.js';
  import { fetchEmote, emoteDetail, emoteMotion } from '#lib/assets/effects/emotes.js';
  import AssetBrowser from '../toolbox/AssetBrowser.svelte';
  import PreviewCanvas from './PreviewCanvas.svelte';
  import { PreviewController, type PreviewSource } from './preview.svelte.js';

  interface Props {
    /** The model's clips: an emote plays the motion whose clip the model has. */
    clips: ClipInfo[];
    /** The emote in effect, or null. */
    value: { id: string; name: string } | null;
    /** Called with the emote to apply (Apply, Enter or double click), or null for none. */
    oncommit?: (emote: EmoteRecord | null) => void;
    /** The node as preview entities; the picker's canvas shows a copy of it playing the previewed emote. */
    source?: PreviewSource | null;
  }

  let { clips, value, oncommit, source = null }: Props = $props();

  const WIDTH = 360;

  let open = $state(false);
  /** The emote being previewed (null: none yet). Apply uses it. */
  let previewed = $state.raw<EmoteRecord | null>(null);
  let button = $state<HTMLButtonElement>();
  let popover = $state<HTMLDivElement>();
  let place = $state({ left: 0, top: 0, maxHeight: 560 });
  let own = $state.raw<PreviewController | null>(null);

  /** Show the node playing an emote (or as it is, for null) on the picker's canvas. */
  function show(emote: EmoteRecord | null) {
    const s = source;
    if (!own || !s || s.kind !== 'entities') return;
    const [root, ...rest] = s.entities;
    if (!root) return;
    if (!emote) {
      void own.show({ kind: 'entities', entities: [{ ...root, emote: undefined }, ...rest] });
      return;
    }
    const { index, clip } = emoteMotion(clips, emote);
    void own.show({
      kind: 'entities',
      entities: [{ ...root, emote: { id: emote.id, name: emote.name, motion: index } }, ...rest],
      clip
    });
  }

  async function openPicker() {
    previewed = null;
    if (source?.kind === 'entities') own = new PreviewController();
    open = true;
    await tick();
    position();
    popover?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
    // The emote in effect plays first; picking another previews that one instead.
    const current = value ? await fetchEmote(value.id).catch(() => null) : null;
    if (open && previewed === null) show(current);
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
    if (below >= 420 || below >= above) place = { left, top: r.bottom + 4, maxHeight: Math.min(620, below) };
    else place = { left, top: Math.max(8, r.top - 4 - Math.min(620, above)), maxHeight: Math.min(620, above) };
  }

  function select(emote: EmoteRecord) {
    previewed = emote;
    show(emote);
  }

  function commit(emote: EmoteRecord | null) {
    oncommit?.(emote);
    closePicker();
  }

  function onKey(e: KeyboardEvent) {
    // Nothing typed in the picker may reach the editor's shortcuts (Delete would remove the selected node).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
      button?.focus();
    }
  }
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
  aria-haspopup="dialog"
  aria-expanded={open}
  title={value ? `${value.name} (${value.id})` : 'No emote'}
>
  <span class="label" class:muted={!value}>{value ? value.name : '(no emote)'}</span>
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

    <div class="hint">Click an emote to preview it, then Apply. Its clip plays with its effects.</div>
    <div class="list">
      <AssetBrowser
        endpoint="/api/emotes"
        placeholder="Search emotes by name or id..."
        selectedId={previewed?.id ?? null}
        onselect={(r: EmoteRecord) => select(r)}
        onactivate={(r: EmoteRecord) => commit(r)}
        detail={(r: EmoteRecord) => emoteDetail(r)}
      />
    </div>

    <div class="footer">
      <span class="pick" title={previewed?.name ?? ''}>
        {#if previewed === null}{value
            ? `In use: ${value.name}`
            : 'Nothing selected'}{:else if previewed.id === value?.id}Already in use{:else}{previewed.name}{/if}
      </span>
      <button onclick={() => commit(null)} disabled={!value} title="Stop the emote's effects">No emote</button>
      <button onclick={() => closePicker()}>Cancel</button>
      <button
        class="primary"
        disabled={previewed === null || previewed.id === value?.id}
        onclick={() => previewed && commit(previewed)}>Apply</button
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
  .muted {
    color: var(--muted);
    font-style: italic;
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
  .hint {
    font-size: 11px;
    color: var(--muted);
    flex: none;
  }
  .list {
    flex: 1;
    min-height: 220px;
    display: flex;
    flex-direction: column;
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
</style>
