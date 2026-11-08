<script lang="ts">
  import { T } from '@threlte/core';
  import { TransformControls } from '@threlte/extras';
  import { onMount } from 'svelte';
  import AssetBrowser from '#lib/components/AssetBrowser.svelte';
  import SceneItem from '#lib/components/SceneItem.svelte';
  import Viewport from '#lib/components/Viewport.svelte';
  import type { ViewApi } from '#lib/components/viewapi.js';
  import { downloadBuffer, exportGlb, safeFilename } from '#lib/export/glb.js';
  import { decomposeForScene, extractNearby, sceneMatrix } from '#lib/maps/extract.js';
  import type { Vec3 } from '#lib/scene/model.js';
  import type { MapData } from '#lib/types.js';
  import { Vector3 } from 'three';
  import { SceneState } from '#lib/scene/store.svelte.js';
  import { loadCurrent, loadSaved, type OutfitSnapshot } from '#lib/stores/outfits.js';

  interface Entry {
    id: string;
    name: string;
    glb: string;
    scale?: number;
  }

  const scene = new SceneState();
  const viewApi: ViewApi = {};
  let tab = $state<'props' | 'npcs' | 'maps' | 'characters'>('props');
  let radius = $state(1500);
  let extracting = $state(false);
  let ready = $state(false);
  let outfits = $state<{ name: string; snapshot: OutfitSnapshot }[]>([]);
  let message = $state('');

  const RAD = 180 / Math.PI;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  onMount(() => {
    if (import.meta.env.DEV) (window as unknown as { __scene: SceneState }).__scene = scene;
    scene.loadLocal(localStorage);
    ready = true;
  });

  // Autosave on every change once the stored scene has been loaded.
  $effect(() => {
    if (!ready) return;
    void scene.objects;
    scene.saveLocal(localStorage);
  });

  function refreshOutfits() {
    const list: { name: string; snapshot: OutfitSnapshot }[] = [
      { name: 'Base female', snapshot: { version: 1, gender: 1, skin: 2, items: [] } },
      { name: 'Base male', snapshot: { version: 1, gender: 0, skin: 2, items: [] } }
    ];
    const current = loadCurrent(localStorage);
    if (current) list.push({ name: 'Dresser outfit (current)', snapshot: current });
    for (const [name, snapshot] of Object.entries(loadSaved(localStorage))) list.push({ name, snapshot });
    outfits = list;
  }

  $effect(() => {
    if (tab === 'characters') refreshOutfits();
  });

  /** New objects appear on the ground where the camera is looking. */
  function spawnPoint(): Vec3 {
    const t = viewApi.target?.();
    // Fan successive objects out so they do not pile up on one spot.
    const n = scene.objects.length;
    const dx = ((n % 6) - 2.5) * 110;
    const dz = Math.floor(n / 6) * 110;
    return [round((t?.x ?? 0) + dx), 0, round((t?.z ?? 0) + dz)];
  }

  function addEntry(entry: Entry, kind: 'prop' | 'npc') {
    const s = entry.scale ?? 1;
    scene.add({ kind, name: entry.name, glb: entry.glb, position: spawnPoint(), scale: [s, s, s] });
  }

  function addMap(entry: { id: string; name: string }) {
    scene.add({ kind: 'map', name: entry.name, mapId: entry.id });
  }

  /** Turn the props of the selected map around the camera target into individual scene objects. */
  async function extractFromSelected() {
    const map = scene.selected;
    if (!map || map.kind !== 'map' || !map.mapId) return;
    extracting = true;
    message = '';
    try {
      const res = await fetch(`/api/maps/${map.mapId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as MapData;
      const toWorld = sceneMatrix(map.position, map.rotation, map.scale);
      const t = viewApi.target?.() ?? new Vector3();
      const center = t.clone().applyMatrix4(toWorld.clone().invert());
      const LIMIT = 300;
      const props = extractNearby(data, center, radius, LIMIT);
      if (props.length === 0) {
        message = 'No props within that radius of the camera target.';
        return;
      }
      scene.record();
      const added = props.map((p) => {
        const parts = decomposeForScene(toWorld.clone().multiply(p.matrix));
        const name = p.glb.split('/').pop()!.replace(/\.glb$/i, '');
        return { kind: 'prop' as const, name, glb: p.glb, ...parts };
      });
      scene.addMany(added);
      message = `Added ${added.length} props${props.length === LIMIT ? ` (limited to the nearest ${LIMIT})` : ''}.`;
    } catch (e) {
      message = `Could not extract props: ${e instanceof Error ? e.message : e}`;
    } finally {
      extracting = false;
    }
  }

  function addCharacter(name: string, snapshot: OutfitSnapshot) {
    scene.add({ kind: 'character', name, outfit: structuredClone($state.snapshot(snapshot)), position: spawnPoint() });
  }

  function syncSelected() {
    const g = scene.selectedGroup;
    const id = scene.selectedId;
    if (!g || !id) return;
    scene.update(
      id,
      {
        position: [g.position.x, g.position.y, g.position.z],
        rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
        scale: [g.scale.x, g.scale.y, g.scale.z]
      },
      false
    );
  }

  function setVec(key: 'position' | 'rotation' | 'scale', axis: number, value: number, degrees = false) {
    const obj = scene.selected;
    if (!obj || Number.isNaN(value)) return;
    const next = [...obj[key]] as Vec3;
    next[axis] = degrees ? value / RAD : value;
    scene.update(obj.id, { [key]: next });
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) scene.redo();
      else scene.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      scene.redo();
    } else if (mod && e.key.toLowerCase() === 'd' && scene.selectedId) {
      e.preventDefault();
      scene.duplicate(scene.selectedId);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && scene.selectedId) {
      scene.remove(scene.selectedId);
    } else if (!mod && e.key.toLowerCase() === 'g') scene.mode = 'translate';
    else if (!mod && e.key.toLowerCase() === 'r') scene.mode = 'rotate';
    else if (!mod && e.key.toLowerCase() === 's') scene.mode = 'scale';
    else if (!mod && e.key.toLowerCase() === 'f') focusSelected();
    else if (e.key === 'Escape') scene.select(null);
  }

  let exporting = $state(false);

  /** Export the whole scene (static pose) or just the selected object with its playing animation. */
  async function exportScene(onlySelected: boolean) {
    exporting = true;
    message = '';
    try {
      const targets = onlySelected
        ? scene.objects.filter((o) => o.id === scene.selectedId)
        : scene.objects.filter((o) => o.visible && o.kind !== 'map');
      const groups = targets.map((o) => scene.groups.get(o.id)).filter((g): g is NonNullable<typeof g> => !!g);
      if (groups.length === 0) {
        message = 'Nothing to export.';
        return;
      }
      const clip = onlySelected ? scene.players.get(targets[0].id)?.clip : null;
      const buffer = await exportGlb(groups, { animations: clip ? [clip] : [] });
      downloadBuffer(buffer, safeFilename(onlySelected ? targets[0].name : 'scene'));
    } catch (e) {
      message = `Export failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      exporting = false;
    }
  }

  function focusSelected() {
    const g = scene.selectedGroup;
    if (g) viewApi.frame?.(g);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(scene.toData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message = scene.loadJson(await file.text()) ? '' : 'That file is not a valid scene.';
  }

  const selected = $derived(scene.selected);
  const clips = $derived(selected ? (scene.clipNames[selected.id] ?? []) : []);
</script>

<svelte:window onkeydown={onKey} />

<div class="layout">
  <aside class="left">
    <div class="tabs">
      <button class:active={tab === 'props'} onclick={() => (tab = 'props')}>Props</button>
      <button class:active={tab === 'npcs'} onclick={() => (tab = 'npcs')}>NPCs</button>
      <button class:active={tab === 'maps'} onclick={() => (tab = 'maps')}>Maps</button>
      <button class:active={tab === 'characters'} onclick={() => (tab = 'characters')}>Characters</button>
    </div>
    {#if tab === 'characters'}
      <ul class="plain">
        {#each outfits as outfit}
          <li>
            <button onclick={() => addCharacter(outfit.name, outfit.snapshot)}>
              <span class="name">{outfit.name}</span>
              <span class="detail">{outfit.snapshot.gender === 1 ? 'Female' : 'Male'} - {outfit.snapshot.items.length} items</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="hint">Dress a character in the Dresser and save the outfit to see it here.</p>
    {:else}
      {#key tab}
        <AssetBrowser
          endpoint={`/api/${tab}`}
          placeholder={tab === 'props' ? 'Search props...' : tab === 'npcs' ? 'Search NPCs...' : 'Search maps...'}
          onpick={(entry: Entry & { xblock?: string }) => (tab === 'maps' ? addMap(entry) : addEntry(entry, tab === 'props' ? 'prop' : 'npc'))}
        />
      {/key}
    {/if}
  </aside>

  <section class="center">
    <Viewport interactive {viewApi} onGroundClick={() => scene.select(null)} gridSize={4000}>
      {#each scene.objects as obj (obj.id)}
        <SceneItem {obj} {scene} />
      {/each}
      {#if scene.selectedGroup && selected?.visible}
        <TransformControls
          object={scene.selectedGroup}
          mode={scene.mode}
          translationSnap={scene.snap ? 10 : undefined}
          rotationSnap={scene.snap ? Math.PI / 12 : undefined}
          scaleSnap={scene.snap ? 0.1 : undefined}
          onmouseDown={() => scene.record()}
          onobjectChange={syncSelected}
        />
      {/if}
    </Viewport>
    <div class="hud">
      <button onclick={() => scene.undo()} disabled={!scene.canUndo} title="Undo (Ctrl+Z)">Undo</button>
      <button onclick={() => scene.redo()} disabled={!scene.canRedo} title="Redo (Ctrl+Y)">Redo</button>
      <span class="sep"></span>
      <button class:active={scene.mode === 'translate'} onclick={() => (scene.mode = 'translate')} title="Move (G)">Move</button>
      <button class:active={scene.mode === 'rotate'} onclick={() => (scene.mode = 'rotate')} title="Rotate (R)">Rotate</button>
      <button class:active={scene.mode === 'scale'} onclick={() => (scene.mode = 'scale')} title="Scale (S)">Scale</button>
      <label><input type="checkbox" bind:checked={scene.snap} /> snap</label>
    </div>
  </section>

  <aside class="right">
    <h3>Scene ({scene.objects.length})</h3>
    <ul class="plain outliner">
      {#each scene.objects as obj (obj.id)}
        <li class:sel={obj.id === scene.selectedId}>
          <button class="pick" onclick={() => scene.select(obj.id)}>
            <span class="kind">{obj.kind}</span>
            <span class="name">{obj.name}</span>
          </button>
          <button onclick={() => scene.update(obj.id, { visible: !obj.visible })} title="Toggle visibility">{obj.visible ? 'o' : '-'}</button>
          <button onclick={() => scene.remove(obj.id)} title="Delete">x</button>
        </li>
      {/each}
    </ul>

    {#if selected}
      <h3>Inspector</h3>
      <label class="field">Name
        <input value={selected.name} onchange={(e) => scene.update(selected.id, { name: e.currentTarget.value })} />
      </label>
      {#each [['position', 'Position', 1, false], ['rotation', 'Rotation (deg)', 1, true], ['scale', 'Scale', 0.05, false]] as [key, label, step, deg]}
        <div class="vec">
          <span>{label}</span>
          {#each [0, 1, 2] as axis}
            <input
              type="number"
              step={step as number}
              value={round((selected[key as 'position'][axis] ?? 0) * (deg ? RAD : 1))}
              onchange={(e) => setVec(key as 'position', axis, e.currentTarget.valueAsNumber, deg as boolean)}
            />
          {/each}
        </div>
      {/each}
      {#if selected.kind === 'map'}
        <label class="field">Extract props within radius of the camera target
          <input type="number" min="50" step="50" bind:value={radius} />
        </label>
        <button onclick={extractFromSelected} disabled={extracting}>{extracting ? 'Extracting...' : 'Extract nearby props'}</button>
        <p class="hint">Moves nothing: the map stays; the props are copied as editable objects (up to 300).</p>
      {/if}
      {#if clips.length}
        <label class="field">Animation
          <select value={selected.clip ?? ''} onchange={(e) => scene.update(selected.id, { clip: e.currentTarget.value || undefined })}>
            <option value="">(none)</option>
            {#each clips as name}<option value={name}>{name}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="row">
        <button onclick={focusSelected} title="Frame in view (F)">Focus</button>
        {#if selected.kind !== 'map'}
          <button onclick={() => exportScene(true)} disabled={exporting} title="Export this object with its animation">GLB</button>
        {/if}
        <button onclick={() => scene.duplicate(selected.id)}>Duplicate</button>
        <button onclick={() => scene.remove(selected.id)}>Delete</button>
      </div>
    {/if}

    <h3>File</h3>
    <div class="row">
      <button onclick={exportJson}>Export JSON</button>
      <label class="file">Import JSON<input type="file" accept="application/json" onchange={importJson} hidden /></label>
    </div>
    <button onclick={() => exportScene(false)} disabled={exporting || scene.objects.length === 0}>{exporting ? 'Exporting...' : 'Export scene as GLB'}</button>
    <button onclick={() => scene.clear()} disabled={scene.objects.length === 0}>Clear scene</button>
    <p class="hint">The scene is saved in this browser automatically.</p>
    {#if message}<p class="error">{message}</p>{/if}
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 300px 1fr 300px;
    height: 100%;
  }
  aside {
    padding: 8px;
    background: var(--panel);
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .left {
    border-right: 1px solid var(--border);
  }
  .right {
    border-left: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    flex: 1;
    padding: 4px;
  }
  button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  h3 {
    margin: 8px 0 2px;
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul.plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.plain li button {
    width: 100%;
    text-align: left;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    display: flex;
    flex-direction: column;
  }
  .detail,
  .hint {
    color: var(--muted);
    font-size: 11px;
  }
  .hint {
    margin: 4px 0;
  }
  .outliner {
    max-height: 220px;
    overflow-y: auto;
  }
  .outliner li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .outliner li.sel {
    background: #25305a;
  }
  .outliner .pick {
    flex: 1;
    flex-direction: row;
    gap: 6px;
    min-width: 0;
  }
  .outliner .kind {
    color: var(--muted);
    font-size: 11px;
    width: 52px;
    flex: none;
  }
  .outliner .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .outliner li > button:not(.pick) {
    width: 24px;
    padding: 0;
    flex: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
  }
  .vec {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
  }
  .vec span {
    grid-column: 1 / -1;
  }
  .vec input {
    min-width: 0;
    width: 100%;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .row button {
    flex: 1;
  }
  .file {
    flex: 1;
    text-align: center;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel-2);
    cursor: pointer;
  }
  .error {
    color: #ff8080;
    font-size: 12px;
  }
  .center {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgb(18 19 26 / 0.85);
    padding: 6px;
    border-radius: 6px;
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 4px;
  }
</style>
