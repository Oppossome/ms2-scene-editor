<script lang="ts">
  import ClipPicker from './ClipPicker.svelte';
  import PreviewCanvas from './PreviewCanvas.svelte';
  import type { PreviewController } from './preview.svelte.js';

  let { preview, empty = 'Select something to preview it.' }: { preview: PreviewController; empty?: string } = $props();
</script>

<div class="stage">
  <div class="view"><PreviewCanvas {preview} {empty} /></div>

  {#if preview.facts || preview.progress}
    <div class="facts">
      {preview.facts}
      {#if preview.progress && preview.progress.loaded < preview.progress.total}
        - loading models {preview.progress.loaded}/{preview.progress.total}
      {/if}
    </div>
  {/if}

  {#if preview.clips.length}
    <div class="controls">
      <div class="picker"><ClipPicker clips={preview.clips} value={preview.clip} source={preview.source} oncommit={(name) => void preview.play(name)} /></div>
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
    flex: 1;
    min-height: 0;
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
  .picker {
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
