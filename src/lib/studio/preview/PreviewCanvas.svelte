<script lang="ts">
  import { T } from '@threlte/core';
  import Viewport from '#lib/studio/viewport/Viewport.svelte';
  import type { PreviewController } from './preview.svelte.js';

  let { preview, empty = 'Select something to preview it.' }: { preview: PreviewController; empty?: string } = $props();
</script>

<div class="view">
  <Viewport
    object={preview.object}
    frameToken={preview.frameToken}
    grid={!preview.isMap}
    gridSize={preview.isMap ? 4000 : 400}
    background={preview.environment?.background}
    fog={preview.environment?.fog}
    onTick={(d) => preview.update(d)}
  >
    {#if preview.object}<T is={preview.object} />{/if}
  </Viewport>

  {#if !preview.object && !preview.status}<div class="note">{empty}</div>{/if}
  {#if preview.status}<div class="note" class:error={preview.failed}>{preview.status}</div>{/if}
  {#if preview.progress && preview.progress.loaded < preview.progress.total}
    <div class="bar">
      <div style:width={`${(preview.progress.loaded / Math.max(1, preview.progress.total)) * 100}%`}></div>
    </div>
  {/if}
</div>

<style>
  .view {
    position: relative;
    height: 100%;
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
</style>
