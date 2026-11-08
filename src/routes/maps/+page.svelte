<script lang="ts">
  import { T } from '@threlte/core';
  import type { Group } from 'three';
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import Viewport from '#lib/components/Viewport.svelte';
  import { buildMap, type BuiltMap, type MapProgress } from '#lib/maps/instancing.js';
  import type { MapData } from '#lib/types.js';

  interface Entry {
    id: string;
    name: string;
    xblock: string;
  }

  let selected = $state<Entry | null>(null);
  let data = $state.raw<MapData | null>(null);
  let root = $state.raw<Group | null>(null);
  let progress = $state<MapProgress | null>(null);
  let status = $state('');
  let frameToken = $state(0);
  let built: BuiltMap | null = null;
  let generation = 0;

  async function open(entry: Entry) {
    const gen = ++generation;
    selected = entry;
    built?.dispose();
    built = null;
    root = null;
    data = null;
    progress = null;
    status = 'Loading map data...';
    try {
      const res = await fetch(`/api/maps/${entry.id}`);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const map = (await res.json()) as MapData;
      if (gen !== generation) return;
      data = map;
      status = '';
      const result = buildMap(map, {
        onProgress: (p) => {
          if (gen !== generation) return;
          progress = p;
          // Frame the view once a first batch of models is in.
          if (p.modelsLoaded === Math.min(8, p.modelsTotal)) frameToken++;
        },
        cancelled: () => gen !== generation
      });
      // The group fills up while models load, so show it right away.
      built = result;
      root = result.group;
      await result.done;
      if (gen === generation) frameToken++;
    } catch (e) {
      if (gen === generation) status = `Failed: ${e instanceof Error ? e.message : e}`;
    }
  }
</script>

<div class="layout">
  <aside>
    <AssetBrowser
      endpoint="/api/maps"
      placeholder="Search maps..."
      selectedId={selected?.id ?? null}
      onpick={open}
      detail={(r: Entry) => `${r.id} - ${r.xblock}`}
    />
  </aside>

  <section>
    <Viewport object={root} {frameToken} grid={false}>
      {#if root}<T is={root} />{/if}
    </Viewport>
    <div class="hud">
      <div class="title">{selected?.name ?? 'Pick a map'}</div>
      {#if status}<div class="status">{status}</div>{/if}
      {#if data}
        <div class="status">
          {data.items.length.toLocaleString()} props, {data.models.length.toLocaleString()} models
          {#if data.unresolved}({data.unresolved} entities have no model){/if}
        </div>
      {/if}
      {#if progress && progress.modelsLoaded < progress.modelsTotal}
        <div class="status">Loading models {progress.modelsLoaded}/{progress.modelsTotal}</div>
      {/if}
      {#if progress?.failed}<div class="status warn">{progress.failed} models failed to load</div>{/if}
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
    min-height: 0;
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
    gap: 4px;
    max-width: 420px;
  }
  .title {
    font-weight: 600;
  }
  .status {
    color: var(--muted);
    font-size: 12px;
  }
  .warn {
    color: #ffb070;
  }
</style>
