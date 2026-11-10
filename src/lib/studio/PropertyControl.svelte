<script lang="ts">
  import type { PropertyControl } from '#lib/scene/property.svelte.js';
  import type { Studio } from './controller.svelte.js';
  import type { PreviewSource } from './preview.svelte.js';
  import ClipPicker from './ClipPicker.svelte';
  import FrameScrubber from './FrameScrubber.svelte';
  import NumberField from './NumberField.svelte';
  import PaletteRow from './PaletteRow.svelte';
  import BackgroundPicker from './BackgroundPicker.svelte';
  import { backdropPath } from '#lib/scene/environment.js';

  let { row, studio, source }: { row: PropertyControl; studio: Studio; source: PreviewSource | null } = $props();
  const store = $derived(studio.store);
  const selected = $derived(store.selected);
  let pickingBackdrop = $state(false);
  function commit(patch: Parameters<typeof store.update>[1], continuous = false) {
    if (selected) store.update(selected.id, patch, !continuous);
  }
</script>

{#if row.type === 'string'}
  <input value={row.value} onchange={(e) => commit(row.edit(e.currentTarget.value))} />
{:else if row.type === 'number'}
  <NumberField value={row.value} step={row.step} min={row.min} max={row.max}
    onstart={() => store.beginGesture()} onend={() => store.endGesture()} onchange={(value) => commit(row.edit(value), true)} />
{:else if row.type === 'vec3'}
  <div class="vec" title={row.disabled}>
    {#each ['X', 'Y', 'Z'] as axis, i}
      <NumberField label={axis} value={row.value[i]} step={row.step} min={row.min} max={row.max} disabled={!!row.disabled}
        onstart={() => store.beginGesture()} onend={() => store.endGesture()}
        onchange={(value) => {
          const next: [number, number, number] = [...row.value];
          next[i] = value;
          commit(row.edit(next), true);
        }} />
    {/each}
  </div>
{:else if row.type === 'bool'}
  <input type="checkbox" checked={row.value} onchange={(e) => commit(row.edit(e.currentTarget.checked))} />
{:else if row.type === 'enum'}
  <select value={row.value} onchange={(e) => commit(row.edit(e.currentTarget.value))}>
    {#each row.options ?? [] as option}<option value={option.value}>{option.label}</option>{/each}
  </select>
{:else if row.type === 'clip'}
  <ClipPicker clips={row.clips ?? []} value={row.value} {source} oncommit={(value) => commit(row.edit(value))} />
{:else if row.type === 'backdrop'}
  <button title={row.value || 'None'} onclick={() => { pickingBackdrop = true; }}>Choose...</button>
  <button onclick={() => commit(row.edit(''))} disabled={!row.value}>None</button>
  {#if pickingBackdrop}
    <BackgroundPicker {studio} value={row.value} onclose={() => { pickingBackdrop = false; }}
      onpick={(name) => { commit(row.edit(backdropPath(name))); pickingBackdrop = false; }} />
  {/if}
{:else if row.type === 'palette'}
  <PaletteRow palette={row.palette ?? 0} value={row.value} channel={row.channel} onpick={(value) => commit(row.edit(value))} />
{:else if row.type === 'transport'}
  {#if row.max !== undefined && selected}
    {@const id = selected.id}
    <FrameScrubber frame={row.frame} max={row.max} live={() => studio.runtime.currentFrame(id)}
      onstart={() => store.beginGesture()} onend={() => store.endGesture()}
      onscrub={(frame, dragging) => dragging ? studio.setFrame(id, frame, false) : studio.holdFrame(id, frame)}
      onresume={() => commit({ freeze: undefined })} />
  {/if}
{:else if row.type === 'action'}
  <button onclick={() => commit(row.edit())}>{row.value}</button>
{:else}
  <span class="readonly" title={String(row.value)}>{row.value}</span>
{/if}

<style>
  input:not([type='checkbox']), select { width: 100%; padding: 3px 6px; }
  .vec { display: flex; gap: 3px; }
  .readonly { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b9bdd0; }
</style>
