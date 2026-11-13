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
  const sections = $derived.by(() => {
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
      if (!selected) return [];
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
        channels: itemRecord?.channels ?? [true, true]
      });
    }
    const groups = new Map<string, PropertyControl[]>();
    for (const control of controls) {
      const rows = groups.get(control.section) ?? [];
      rows.push(control);
      groups.set(control.section, rows);
    }
    return [...groups].map(([section, rows]) => ({ section, rows }));
  });
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
    {#each sections as section (section.section)}
      <details open>
        <summary>{section.section}</summary>
        {#each section.rows as row (row.key)}
          <div class="row" class:wide={row.type === 'palette'}>
            <span class="label" title={row.disabled ?? row.label}>{row.label}</span>
            <div class="value"><PropertyEditor {row} {studio} source={clipSource} /></div>
          </div>
        {/each}
        {#if section.section === 'Transform' && selected?.type === 'group'}
          <div class="extra">
            <button
              onclick={() => studio.centerGroup(selected.id)}
              disabled={!groupCenterPositions}
              title="Center the group on its children's visible bounds without moving them">Center on children</button
            >
            <p class="hint">
              Moves the group origin to the center of its children's visible bounds; their world positions stay
              unchanged.
            </p>
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
  .error {
    color: #ff9a9a;
    padding: 8px;
    white-space: pre-wrap;
  }
</style>
