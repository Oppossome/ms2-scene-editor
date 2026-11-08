<script lang="ts">
  import { T } from '@threlte/core';
  import { onMount } from 'svelte';
  import ItemBrowser from '#lib/components/ItemBrowser.svelte';
  import Viewport from '#lib/components/Viewport.svelte';
  import { slotLabel } from '#lib/character/slots.js';
  import { downloadBuffer, exportGlb, safeFilename } from '#lib/export/glb.js';
  import { DresserState } from '#lib/stores/dresser.svelte.js';
  import {
    deleteNamed,
    loadCurrent,
    loadSaved,
    parseSnapshotJson,
    saveCurrent,
    saveNamed,
    type OutfitSnapshot
  } from '#lib/stores/outfits.js';

  const dresser = new DresserState();

  let ready = $state(false);
  let saved = $state<Record<string, OutfitSnapshot>>({});
  let outfitName = $state('');

  onMount(() => {
    if (import.meta.env.DEV) (window as unknown as { __dresser: DresserState }).__dresser = dresser;
    saved = loadSaved(localStorage);
    const current = loadCurrent(localStorage);
    void (current ? dresser.restore(current) : dresser.load(1)).finally(() => (ready = true));
    return () => {
      dresser.rig?.dispose();
      dresser.player?.dispose();
    };
  });

  // Autosave the current outfit once the initial restore finished.
  $effect(() => {
    if (!ready) return;
    const snap = dresser.snapshot();
    saveCurrent(localStorage, snap);
  });

  function saveOutfit() {
    const name = outfitName.trim();
    if (!name) return;
    saveNamed(localStorage, name, dresser.snapshot());
    saved = loadSaved(localStorage);
    outfitName = '';
  }

  function removeOutfit(name: string) {
    deleteNamed(localStorage, name);
    saved = loadSaved(localStorage);
  }

  let exporting = $state(false);
  let withAnimation = $state(true);

  async function exportCharacter() {
    if (!dresser.rig) return;
    exporting = true;
    dresser.error = '';
    try {
      const clip = withAnimation ? dresser.player?.clip : null;
      const buffer = await exportGlb(dresser.rig.root, { animations: clip ? [clip] : [] });
      downloadBuffer(buffer, safeFilename(dresser.gender === 1 ? 'female_character' : 'male_character'));
    } catch (e) {
      dresser.error = `Export failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      exporting = false;
    }
  }

  function exportOutfit() {
    const blob = new Blob([JSON.stringify(dresser.snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'outfit.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importOutfit(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const snap = parseSnapshotJson(await file.text());
    if (snap) await dresser.restore(snap);
    else dresser.error = 'That file is not a valid outfit.';
  }

  const wornIds = $derived(new Set(dresser.worn.map((i) => i.id)));
  const css = (argb: string) => '#' + argb.replace(/^0x/i, '').slice(-6);
</script>

<div class="layout">
  <aside class="left">
    <ItemBrowser
      gender={dresser.gender}
      {wornIds}
      onpick={(item) => (wornIds.has(item.id) ? dresser.unequip(item.id) : dresser.equip(item))}
    />
  </aside>

  <section class="center">
    <Viewport
      object={dresser.rig?.root ?? null}
      frameToken={dresser.frameToken}
      onTick={(d) => dresser.player?.update(d)}
    >
      {#if dresser.rig}<T is={dresser.rig.root} />{/if}
    </Viewport>
    {#if dresser.loading}<div class="badge">Loading...</div>{/if}
  </section>

  <aside class="right">
    <h3>Character</h3>
    <div class="row">
      <button class:active={dresser.gender === 1} onclick={() => dresser.setGender(1)}>Female</button>
      <button class:active={dresser.gender === 0} onclick={() => dresser.setGender(0)}>Male</button>
    </div>

    {#if dresser.skinColors.length}
      <div class="swatches" title="Skin tone">
        {#each dresser.skinColors as color, i}
          <button
            class="swatch"
            class:on={dresser.skinIndex === i}
            style:background={css(color.ch0)}
            onclick={() => dresser.setSkin(i)}
            aria-label={`Skin tone ${i}`}
          ></button>
        {/each}
      </div>
    {/if}

    <h3>Outfit</h3>
    {#if dresser.worn.length === 0}
      <p class="muted">Click an item to wear it.</p>
    {:else}
      <ul>
        {#each dresser.worn as item (item.id)}
          <li>
            <span class="slots">{item.slots.map(slotLabel).join('/')}</span>
            <span class="name" title={item.name}>{item.name}</span>
            <button onclick={() => dresser.unequip(item.id)} title="Remove">x</button>
            {#if item.palette && dresser.palettes[item.palette]}
              <div class="swatches full">
                {#each dresser.palettes[item.palette] as color}
                  <button
                    class="swatch"
                    class:on={dresser.colorIndexOf(item) === color.sn}
                    style:background={css(color.palette)}
                    onclick={() => dresser.setItemColor(item, color.sn)}
                    aria-label={`Colour ${color.sn}`}
                  ></button>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <button onclick={() => dresser.clearAll()}>Remove all</button>
    {/if}

    <h3>Saved outfits</h3>
    <div class="row">
      <input placeholder="Name" bind:value={outfitName} onkeydown={(e) => e.key === 'Enter' && saveOutfit()} />
      <button onclick={saveOutfit} disabled={!outfitName.trim()}>Save</button>
    </div>
    <ul>
      {#each Object.keys(saved) as name}
        <li>
          <span class="name">{name}</span>
          <button onclick={() => dresser.restore(saved[name])}>Load</button>
          <button onclick={() => removeOutfit(name)} title="Delete">x</button>
        </li>
      {/each}
    </ul>
    <div class="row">
      <button onclick={exportOutfit}>Export JSON</button>
      <label class="file">Import JSON<input type="file" accept="application/json" onchange={importOutfit} hidden /></label>
    </div>

    <h3>Export</h3>
    <button onclick={exportCharacter} disabled={exporting || !dresser.rig}>{exporting ? 'Exporting...' : 'Export character as GLB'}</button>
    <label class="check"><input type="checkbox" bind:checked={withAnimation} /> include the playing animation</label>

    <h3>Animation</h3>
    <select value={dresser.clipName} onchange={(e) => dresser.play(e.currentTarget.value)}>
      <option value="">(bind pose)</option>
      {#each dresser.clipNames as name}
        <option value={name}>{name}</option>
      {/each}
    </select>
    <button onclick={() => dresser.togglePlay()} disabled={!dresser.clipName}>{dresser.playing ? 'Pause' : 'Play'}</button>

    {#if dresser.error}<p class="error">{dresser.error}</p>{/if}
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 340px 1fr 290px;
    height: 100%;
  }
  aside {
    padding: 8px;
    background: var(--panel);
    min-height: 0;
    overflow-y: auto;
  }
  .left {
    border-right: 1px solid var(--border);
  }
  .right {
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 10px 0 2px;
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .row button {
    flex: 1;
  }
  .row button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    flex-wrap: wrap;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
  }
  li .slots {
    color: var(--muted);
    font-size: 11px;
    width: 56px;
    flex: none;
  }
  li .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li button {
    padding: 0 6px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .swatches.full {
    flex-basis: 100%;
    padding-bottom: 4px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    border: 2px solid transparent;
  }
  .swatch.on {
    border-color: #fff;
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
  .check {
    font-size: 12px;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    margin: 0;
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
  .badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgb(18 19 26 / 0.8);
    padding: 4px 10px;
    border-radius: 6px;
  }
</style>
