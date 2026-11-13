<script lang="ts">
  import { getItem } from '#lib/entities/character/build.js';
  import { CharacterEntity } from '#lib/entities/character/character.svelte.js';
  import { ItemEntity } from '#lib/entities/character/item.svelte.js';
  import { ModelEntity } from '#lib/entities/model.svelte.js';
  import { hasOwnColours } from '#lib/entities/character/appearance.js';
  import type { PropertyControl } from '#lib/entities/property.svelte.js';
  import type { ItemRecord } from '#lib/types.js';
  import type { Studio } from '../controller.svelte.js';
  import PropertyEditor from './PropertyControl.svelte';
  import type { PreviewSource } from '../preview/preview.svelte.js';
  import { sceneEntities } from '../preview/entities.js';

  let { studio }: { studio: Studio } = $props();
  const store = $derived(studio.store);
  const runtime = $derived(studio.runtime);
  const selected = $derived(store.selected);
  const bone = $derived(store.selectedBone);
  const groupCenterPositions = $derived.by(() => {
    void store.revision;
    return selected?.type === 'group' ? runtime.groupCenterPositions(selected.id) : null;
  });
  let itemRecord = $state.raw<ItemRecord | null>(null);
  $effect(() => {
    const id = selected instanceof ItemEntity ? selected.itemId : undefined;
    let active = true;
    itemRecord = null;
    if (id)
      void getItem(id)
        .then((record) => {
          if (active) itemRecord = record;
        })
        .catch((error) => {
          if (active) studio.message = `Could not load item properties: ${error}`;
        });
    return () => {
      active = false;
    };
  });
  const clipSource = $derived.by<PreviewSource | null>(() => {
    const node = selected;
    if (!node) return null;
    // The picker previews a copy of the node (and what a character wears), rendered the way the scene renders it.
    if (node instanceof CharacterEntity)
      return { kind: 'entities', entities: sceneEntities(node, store.itemsOf(node.id)) };
    return node instanceof ModelEntity ? { kind: 'entities', entities: sceneEntities(node) } : null;
  });
  const HIDDEN = new Set(['visible', 'locked']);
  const panel = $derived.by(() => {
    let controls: PropertyControl[];
    if (bone)
      controls = [
        { key: 'name', label: 'Name', value: bone.bone.replace(/_/g, ' '), section: 'Data', type: 'readonly' },
        { key: 'class', label: 'Class', value: 'Bone', section: 'Data', type: 'readonly' },
        {
          key: 'character',
          label: 'Character',
          value: store.node(bone.characterId)?.name ?? '',
          section: 'Data',
          type: 'readonly'
        }
      ];
    else {
      if (!selected) return { name: undefined, subtitle: '', details: [], groups: [] };
      const parent = store.node(selected.parentId);
      controls = selected.controls({
        node: selected,
        parent,
        clips: runtime.clipsOf(selected.id),
        bones: parent?.type === 'character' ? runtime.boneNames(parent.id) : [],
        defaultBone: runtime.defaultBoneOf(selected.id),
        skinned: runtime.isSkinned(selected.id),
        holdable: runtime.isHoldable(selected.id),
        palette: hasOwnColours(itemRecord) ? (itemRecord?.palette ?? 0) : 0,
        channels: itemRecord?.channels ?? [true, true],
        textures: runtime.texturesOf(selected.id)
      });
    }
    // The name and what the node is head the panel; other read-only facts (parent, id, source...) go to Details.
    // Visibility and locking are toggled in the Explorer, and rows that cannot be edited (the offset of skinned
    // clothes) are left out instead of shown greyed.
    const name = controls.find((row) => row.key === 'name');
    const kind = controls.find((row) => row.key === 'class');
    const slots = controls.find((row) => row.key === 'slots');
    const details: PropertyControl[] = [];
    const groups = new Map<string, PropertyControl[]>();
    for (const control of controls) {
      if (control === name || control === kind || HIDDEN.has(control.key) || control.disabled) continue;
      if (control.type === 'readonly') {
        if (control !== slots) details.push(control);
        continue;
      }
      const rows = groups.get(control.section) ?? [];
      rows.push(control);
      groups.set(control.section, rows);
    }
    return {
      name,
      subtitle: [kind?.type === 'readonly' ? kind.value : '', slots?.type === 'readonly' ? slots.value : '']
        .filter(Boolean)
        .join(' · '),
      details,
      groups: [...groups].map(([section, rows]) => ({ section, rows }))
    };
  });
  const sections = $derived(panel.groups);

  /** Main and detail colour pickers are folded under the colour set unless the item already uses them. */
  let channelsOpen = $state(false);
  const usesChannels = $derived(selected instanceof ItemEntity && !!selected.channelColors);
  $effect(() => {
    void selected?.id;
    channelsOpen = false;
  });
  const isChannelRow = (row: PropertyControl) => row.key.startsWith('colorCh');
  const visibleRows = (rows: PropertyControl[]) =>
    channelsOpen || usesChannels ? rows : rows.filter((row) => !isChannelRow(row));
  let outfitName = $state('');
  let saved = $state('');
  function saveOutfit() {
    if (!selected) return;
    saved = studio.saveOutfit(selected.id, outfitName) ? `Saved "${outfitName.trim()}".` : '';
    if (saved) outfitName = '';
  }
</script>

<div class="props">
  {#if !selected && !bone}
    <p class="empty">Select something in the Explorer or the viewport to see its properties.</p>
  {:else}
    <header class="head">
      {#if panel.name?.type === 'string'}
        {@const nameRow = panel.name}
        <input
          class="name"
          value={nameRow.value}
          aria-label="Name"
          onchange={(e) => selected && store.update(selected.id, nameRow.edit(e.currentTarget.value))}
        />
      {:else if panel.name?.type === 'readonly'}
        <div class="name static">{panel.name.value}</div>
      {/if}
      {#if panel.subtitle}<div class="subtitle">{panel.subtitle}</div>{/if}
    </header>
    {#each sections as section (section.section)}
      {@const rows = visibleRows(section.rows)}
      {@const folded = section.rows.some(isChannelRow) && !usesChannels}
      <details open>
        <summary>{section.section}</summary>
        {#each rows as row (row.key)}
          <div class="row" class:wide={row.type === 'palette'} class:full={row.type === 'texture'}>
            {#if row.type !== 'texture'}<span class="label" title={row.label}>{row.label}</span>{/if}
            <div class="value"><PropertyEditor {row} {studio} source={clipSource} /></div>
          </div>
          {#if row.key === 'color' && folded}
            <div class="row">
              <span></span>
              <button class="link" onclick={() => (channelsOpen = !channelsOpen)} aria-expanded={channelsOpen}>
                {channelsOpen ? '▾' : '▸'} Main / detail colours
              </button>
            </div>
          {/if}
        {/each}
        {#if section.section === 'Transform' && selected?.type === 'group'}
          <div class="extra">
            <button
              onclick={() => studio.centerGroup(selected.id)}
              disabled={!groupCenterPositions}
              title="Move the group origin to the center of its children's visible bounds; their world positions stay unchanged"
              >Center on children</button
            >
          </div>
        {/if}
      </details>
    {/each}
    {#if selected?.type === 'character'}
      {@const character = selected}
      <details open>
        <summary>Outfit</summary>
        <div class="extra">
          <div class="inline">
            <input
              placeholder="Outfit name"
              bind:value={outfitName}
              onkeydown={(e) => e.key === 'Enter' && saveOutfit()}
            />
            <button onclick={saveOutfit} disabled={!outfitName.trim()}>Save outfit</button>
          </div>
          {#if saved}<p class="hint">{saved}</p>{/if}
          <button onclick={() => store.setOutfit(character.id, [])}>Remove all items</button>
        </div>
      </details>
    {/if}
    {#if panel.details.length}
      <details class="info">
        <summary>Details</summary>
        {#each panel.details as row (row.key)}
          <div class="row">
            <span class="label" title={row.label}>{row.label}</span>
            <div class="value readonly" title={row.type === 'readonly' ? row.value : ''}>
              {row.type === 'readonly' ? row.value : ''}
            </div>
          </div>
        {/each}
      </details>
    {/if}
    {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
  {/if}
</div>

<style>
  .props {
    height: 100%;
    overflow-y: auto;
    font-size: 12.5px;
  }
  .empty {
    color: var(--muted);
    padding: 10px;
  }
  details {
    border-bottom: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    padding: 5px 8px;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: #1f2230;
    user-select: none;
  }
  .row {
    display: grid;
    grid-template-columns: 84px 1fr;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    min-height: 26px;
  }
  .row.full {
    grid-template-columns: 1fr;
    padding: 4px 8px;
  }
  .row.wide {
    align-items: start;
  }
  .label {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    min-width: 0;
  }
  .extra {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .inline {
    display: flex;
    gap: 4px;
  }
  .inline input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 8px 7px;
    border-bottom: 1px solid var(--border);
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    padding: 3px 6px;
    margin: 0 -6px;
    border-color: transparent;
    background: transparent;
    min-width: 0;
  }
  input.name:hover,
  input.name:focus {
    border-color: var(--border);
    background: var(--panel-2);
  }
  .name.static {
    padding: 3px 0;
    margin: 0;
  }
  .subtitle {
    color: var(--muted);
    font-size: 11px;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 11.5px;
  }
  .link:hover {
    color: inherit;
  }
  .readonly {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    color: #ff9a9a;
    padding: 8px;
    white-space: pre-wrap;
  }
</style>
