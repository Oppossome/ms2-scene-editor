<script lang="ts">
  import { onMount } from 'svelte';
  import type { MenuItem } from '../controller.svelte.js';


  let { x, y, items, onclose }: { x: number; y: number; items: MenuItem[]; onclose: () => void } = $props();

  let el = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);

  // Keep the menu inside the window.
  onMount(() => {
    const r = el!.getBoundingClientRect();
    left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
  });

  function run(item: MenuItem) {
    if (item.disabled) return;
    onclose();
    item.action();
  }
</script>

<svelte:window onpointerdown={(e) => !el?.contains(e.target as Node) && onclose()} onkeydown={(e) => e.key === 'Escape' && onclose()} onblur={onclose} />

<div class="menu" bind:this={el} style:left={`${left || x}px`} style:top={`${top || y}px`} role="menu">
  {#each items as item}
    {#if item.separator}<hr />{/if}
    {#if item.checked !== undefined}
      <button role="menuitemcheckbox" aria-checked={item.checked} class="check" disabled={item.disabled} onclick={() => run(item)}>
        <span class="mark">{item.checked ? '\u2713' : ''}</span>{item.label}
      </button>
    {:else}
      <button role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => run(item)}>{item.label}</button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 100;
    min-width: 180px;
    padding: 4px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }
  button {
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 3px;
    padding: 5px 10px;
  }
  button:hover:not(:disabled) {
    background: var(--accent);
  }
  .mark {
    display: inline-block;
    width: 1.3em;
  }
  button.danger {
    color: #ff9a9a;
  }
  hr {
    width: 100%;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
