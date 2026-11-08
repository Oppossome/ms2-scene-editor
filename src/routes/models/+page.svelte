<script lang="ts">
  import { T } from '@threlte/core';
  import type { AnimationClip, Object3D } from 'three';
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import Viewport from '#lib/components/Viewport.svelte';
  import { AnimationPlayer } from '#lib/assets/animation.js';
  import { instantiate } from '#lib/assets/loader.js';

  interface Entry {
    id: string;
    name: string;
    glb: string;
    scale?: number;
    level?: number;
  }

  let kind = $state<'npcs' | 'props'>('npcs');
  let selected = $state<Entry | null>(null);
  let object = $state.raw<Object3D | null>(null);
  let clips = $state.raw<AnimationClip[]>([]);
  let clipName = $state('');
  let playing = $state(true);
  let loop = $state(true);
  let frameToken = $state(0);
  let status = $state('');
  let player: AnimationPlayer | null = null;

  async function pick(entry: Entry) {
    selected = entry;
    status = 'Loading...';
    try {
      const loaded = await instantiate(entry.glb);
      if (selected !== entry) return;
      player?.dispose();
      if (entry.scale && entry.scale !== 1) loaded.object.scale.setScalar(entry.scale);
      player = new AnimationPlayer(loaded.object);
      object = loaded.object;
      clips = loaded.animations;
      frameToken++;
      const idle = clips.find((c) => /^idle/i.test(c.name)) ?? clips[0];
      clipName = idle?.name ?? '';
      if (idle) play(idle);
      status = `${clips.length} animation${clips.length === 1 ? '' : 's'}`;
    } catch (e) {
      status = `Failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  function play(clip: AnimationClip) {
    player?.play(clip, loop);
    playing = true;
  }

  function onClipChange() {
    const clip = clips.find((c) => c.name === clipName);
    if (clip) play(clip);
  }

  function togglePlay() {
    if (!player) return;
    if (playing) player.pause();
    else player.resume();
    playing = !playing;
  }
</script>

<div class="layout">
  <aside>
    <div class="tabs">
      <button class:active={kind === 'npcs'} onclick={() => (kind = 'npcs')}>NPCs</button>
      <button class:active={kind === 'props'} onclick={() => (kind = 'props')}>Props</button>
    </div>
    {#key kind}
      <AssetBrowser
        endpoint={`/api/${kind}`}
        placeholder={kind === 'npcs' ? 'Search NPCs...' : 'Search props...'}
        selectedId={selected?.id ?? null}
        onpick={pick}
        detail={(r) => (r.level ? `Lv ${r.level} - ${r.id}` : r.id)}
      />
    {/key}
  </aside>

  <section>
    <Viewport {object} {frameToken} onTick={(d) => player?.update(d)}>
      {#if object}<T is={object} />{/if}
    </Viewport>

    <div class="hud">
      <div class="title">{selected?.name ?? 'Pick a model'}</div>
      <div class="status">{status}</div>
      {#if clips.length}
        <div class="controls">
          <select bind:value={clipName} onchange={onClipChange}>
            {#each clips as clip}
              <option value={clip.name}>{clip.name} ({clip.duration.toFixed(1)}s)</option>
            {/each}
          </select>
          <button onclick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
          <label><input type="checkbox" bind:checked={loop} onchange={onClipChange} /> loop</label>
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
  }
  aside {
    padding: 8px;
    border-right: 1px solid var(--border);
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    flex: 1;
  }
  .tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  section {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgb(18 19 26 / 0.8);
    padding: 8px 10px;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 380px;
  }
  .title {
    font-weight: 600;
  }
  .status {
    color: var(--muted);
    font-size: 12px;
  }
  .controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  select {
    max-width: 200px;
  }
</style>
