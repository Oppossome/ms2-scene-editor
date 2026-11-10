<script lang="ts">
  import { onMount } from 'svelte';
  import { assetUrl } from '#lib/assets/urls.js';
  import type { Studio } from '../controller.svelte.js';

  let {
    studio,
    value,
    onpick,
    onclose
  }: {
    studio: Studio;
    value?: string;
    onpick?: (name: string) => void;
    onclose?: () => void;
  } = $props();

  let names = $state<string[]>([]);
  let failed = $state(false);
  let filter = $state('');

  onMount(async () => {
    try {
      const res = await fetch('/api/backgrounds');
      names = res.ok ? ((await res.json()) as string[]) : [];
    } catch {
      names = [];
    }
    failed = names.length === 0;
  });

  const shown = $derived(names.filter((n) => n.toLowerCase().includes(filter.trim().toLowerCase())));

  function close() {
    if (onclose) onclose();
    else studio.pickingBackdrop = false;
  }

  function pick(name: string) {
    if (onpick) onpick(name);
    else studio.look = { ...studio.look, background: 'image', image: name };
    close();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" onpointerdown={close}>
  <div
    class="dialog"
    role="dialog"
    aria-label="Choose a backdrop"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <header>
      <strong>Backdrop</strong>
      <input type="search" placeholder="Filter..." bind:value={filter} />
      <span class="count">{shown.length} images</span>
      <button onclick={close} aria-label="Close">&times;</button>
    </header>
    {#if failed}
      <p class="empty">No backdrop images found. Run the texture conversion first.</p>
    {:else}
      <div class="grid">
        {#each shown as name (name)}
          <button
            class="cell"
            class:on={value !== undefined
              ? value === `Resource/Image/bg/${name}.png`
              : studio.look.background === 'image' && studio.look.image === name}
            title={name}
            onclick={() => pick(name)}
          >
            <img src={assetUrl(`converted/bg-thumbs/${name}.jpg`)} alt={name} loading="lazy" />
            <span>{name.replace(/^bg_/i, '')}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(900px, 92vw);
    max-height: 84vh;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  header input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
  }
  .count {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  header button {
    border: none;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    padding: 2px 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
    padding: 12px;
    overflow: auto;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border: 2px solid transparent;
    border-radius: 6px;
    background: var(--panel-2);
    text-align: center;
    font-size: 11px;
  }
  .cell:hover {
    border-color: var(--border);
  }
  .cell.on {
    border-color: var(--accent);
  }
  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 4px;
    background: #1b1d26;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 24px;
    color: var(--muted);
  }
</style>
