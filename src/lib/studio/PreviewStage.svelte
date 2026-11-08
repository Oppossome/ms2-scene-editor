<script lang="ts">
  import { T } from '@threlte/core';
  import Viewport from '#lib/components/Viewport.svelte';
  import type { PreviewController } from './preview.svelte.js';

  let { preview, empty = 'Select something to preview it.' }: { preview: PreviewController; empty?: string } = $props();
</script>

<div class="stage">
  <div class="view">
    <Viewport
      object={preview.object}
      frameToken={preview.frameToken}
      grid={!preview.isMap}
      gridSize={preview.isMap ? 4000 : 400}
      onTick={(d) => preview.update(d)}
    >
      {#if preview.object}<T is={preview.object} />{/if}
    </Viewport>

    {#if !preview.object && !preview.status}<div class="note">{empty}</div>{/if}
    {#if preview.status}<div class="note" class:error={preview.failed}>{preview.status}</div>{/if}
    {#if preview.progress && preview.progress.loaded < preview.progress.total}
      <div class="bar"><div style:width={`${(preview.progress.loaded / Math.max(1, preview.progress.total)) * 100}%`}></div></div>
    {/if}
  </div>

  {#if preview.facts || preview.progress}
    <div class="facts">
      {preview.facts}
      {#if preview.progress && preview.progress.loaded < preview.progress.total}
        - loading models {preview.progress.loaded}/{preview.progress.total}
      {/if}
    </div>
  {/if}

  {#if preview.clipNames.length}
    <div class="controls">
      <select value={preview.clip} onchange={(e) => preview.play(e.currentTarget.value)}>
        <option value="">(no animation)</option>
        {#each preview.clipNames as name}<option value={name}>{name}</option>{/each}
      </select>
      <button onclick={() => preview.togglePlay()} disabled={!preview.clip}>{preview.playing ? 'Pause' : 'Play'}</button>
      <label class="loop"><input type="checkbox" checked={preview.loop} onchange={(e) => preview.setLoop(e.currentTarget.checked)} /> loop</label>
    </div>
  {/if}
</div>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100%;
    min-height: 0;
  }
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .note {
    position: absolute;
    left: 8px;
    right: 8px;
    top: 8px;
    font-size: 12px;
    color: var(--muted);
    pointer-events: none;
  }
  .note.error {
    color: #ff8080;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.08);
  }
  .bar div {
    height: 100%;
    background: var(--accent);
  }
  .facts {
    font-size: 11px;
    color: var(--muted);
  }
  .controls {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .controls select {
    flex: 1;
    min-width: 0;
  }
  .loop {
    font-size: 11px;
    color: var(--muted);
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
</style>
