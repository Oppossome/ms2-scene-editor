<script lang="ts">
  import { getItem } from '#lib/character/build.js';
  import { ONE, ZERO, type Vec3 } from '#lib/scene/model.js';
  import { applyChange, describeBone, describeNode, hasOwnColours, type PropRow } from '#lib/scene/properties.js';
  import { pathOf } from '#lib/scene/tree.js';
  import type { ItemRecord } from '#lib/types.js';
  import type { Studio } from './controller.svelte.js';
  import ClipPicker from './ClipPicker.svelte';
  import FrameScrubber from './FrameScrubber.svelte';
  import NumberField from './NumberField.svelte';
  import PaletteRow from './PaletteRow.svelte';
  import type { PreviewSource } from './preview.svelte.js';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);
  const runtime = $derived(studio.runtime);

  const selected = $derived(store.selected);
  const bone = $derived(store.selectedBone);

  let itemRecord = $state.raw<ItemRecord | null>(null);
  $effect(() => {
    const id = selected?.kind === 'item' ? selected.itemId : undefined;
    itemRecord = null;
    if (id) void getItem(id).then((r) => (itemRecord = store.selected?.itemId === id ? r : null));
  });

  /** What the clip picker's canvas shows for the selected node: the node itself with its outfit. */
  const clipSource = $derived.by<PreviewSource | null>(() => {
    const node = selected;
    if (!node) return null;
    if (node.kind === 'character') {
      const items = store.nodes
        .filter((n) => n.parentId === node.id && n.kind === 'item' && n.itemId)
        .map((n) => ({
          id: n.itemId!,
          ...(n.color !== undefined ? { color: n.color } : {}),
          ...(n.channelColors ? { channels: n.channelColors } : {})
        }));
      return { kind: 'character', gender: node.gender ?? 1, skin: node.skin, eye: node.eye, items };
    }
    return node.glb ? { kind: 'model', glb: node.glb, scale: node.scale[0] } : null;
  });

  const sections = $derived.by(() => {
    if (bone) {
      const character = store.node(bone.characterId);
      const info = findBone(runtime.boneTree(bone.characterId), bone.bone);
      return describeBone(character?.name ?? '', bone.bone, info?.children.length ?? 0);
    }
    const node = selected;
    if (!node) return [];
    const parent = store.node(node.parentId);
    return describeNode({
      node,
      parent,
      path: pathOf(store.nodes, node.id),
      clips: runtime.clipsOf(node.id),
      bones: parent?.kind === 'character' ? runtime.boneNames(parent.id) : [],
      defaultBone: runtime.defaultBoneOf(node.id),
      skinned: node.kind === 'item' && runtime.isSkinned(node.id),
      palette: hasOwnColours(itemRecord) ? (itemRecord?.palette ?? 0) : 0,
      channels: itemRecord?.channels ?? [true, true]
    });
  });

  function findBone(list: ReturnType<typeof runtime.boneTree>, name: string): ReturnType<typeof runtime.boneTree>[number] | undefined {
    for (const b of list) {
      if (b.name === name) return b;
      const hit = findBone(b.children, name);
      if (hit) return hit;
    }
    return undefined;
  }

  function edit(key: string, value: unknown) {
    const node = selected;
    const patch = node ? applyChange(key, value, node, { frame: runtime.currentFrame(node.id), clips: runtime.clipsOf(node.id) }) : null;
    if (node && patch) store.update(node.id, patch);
  }

  /** Axis edits are continuous (typing or scrubbing): the first one records an undo step. */
  function setAxis(row: PropRow, axis: number, v: number) {
    const node = selected;
    if (!node) return;
    const next = [...(row.value as Vec3)] as Vec3;
    next[axis] = v;
    const patch = applyChange(row.key, next);
    if (patch) store.update(node.id, patch, false);
  }

  function resetOffset() {
    if (selected) store.update(selected.id, { position: [...ZERO] as Vec3, rotation: [...ZERO] as Vec3, scale: [...ONE] as Vec3 });
  }

  let radius = $state(1500);
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
            <div class="value">
              {#if row.type === 'string'}
                <input value={row.value as string} onchange={(e) => edit(row.key, e.currentTarget.value)} />
              {:else if row.type === 'number'}
                <NumberField
                  value={row.value as number}
                  step={row.step}
                  min={row.min}
                  max={row.max}
                  onstart={() => store.record()}
                  onchange={(v) => edit(row.key, v) /* recorded by update */}
                />
              {:else if row.type === 'vec3'}
                <div class="vec" title={row.disabled}>
                  {#each ['X', 'Y', 'Z'] as axis, i}
                    <NumberField
                      label={axis}
                      value={(row.value as Vec3)[i]}
                      step={row.step}
                      disabled={!!row.disabled}
                      onstart={() => store.record()}
                      onchange={(v) => setAxis(row, i, v)}
                    />
                  {/each}
                </div>
              {:else if row.type === 'bool'}
                <input type="checkbox" checked={row.value as boolean} onchange={(e) => edit(row.key, e.currentTarget.checked)} />
              {:else if row.type === 'enum'}
                <select value={row.value as string} onchange={(e) => edit(row.key, e.currentTarget.value)}>
                  {#each row.options ?? [] as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else if row.type === 'clip'}
                <ClipPicker clips={row.clips ?? []} value={row.value as string} source={clipSource} oncommit={(name) => edit(row.key, name)} />
              {:else if row.type === 'palette'}
                <PaletteRow palette={row.palette ?? 0} value={row.value as number} channel={row.channel} onpick={(i) => edit(row.key, i)} />
              {:else if row.type === 'transport'}
                {#if row.max !== undefined && selected}
                  {@const id = selected.id}
                  <FrameScrubber
                    frame={row.frame}
                    max={row.max}
                    live={() => runtime.currentFrame(id)}
                    onstart={() => store.record()}
                    onscrub={(f, dragging) => (dragging ? studio.setFrame(id, f, false) : studio.holdFrame(id, f))}
                    onresume={() => edit('freeze', false)}
                  />
                {/if}
              {:else if row.type === 'action'}
                <button onclick={resetOffset}>{row.value}</button>
              {:else}
                <span class="readonly" title={String(row.value)}>{row.value}</span>
              {/if}
            </div>
          </div>
        {/each}
      </details>
    {/each}

    {#if selected?.kind === 'map'}
      {@const map = selected}
      <details open>
        <summary>Map</summary>
        <div class="extra">
          <label>Extract props within <input type="number" min="50" step="50" bind:value={radius} /> of the camera target</label>
          <button onclick={() => studio.extractMapProps(map.id, radius)} disabled={studio.busy === 'extract'}>
            {studio.busy === 'extract' ? 'Extracting...' : 'Extract nearby props'}
          </button>
          <p class="hint">The map stays; the props are copied into a new group as editable nodes (up to 300).</p>
        </div>
      </details>
    {/if}
    {#if selected?.kind === 'character'}
      {@const character = selected}
      <details open>
        <summary>Outfit</summary>
        <div class="extra">
          <div class="inline">
            <input placeholder="Outfit name" bind:value={outfitName} onkeydown={(e) => e.key === 'Enter' && saveOutfit()} />
            <button onclick={saveOutfit} disabled={!outfitName.trim()}>Save outfit</button>
          </div>
          {#if saved}<p class="hint">{saved}</p>{/if}
          <button onclick={() => store.setOutfit(character.id, [])}>Remove all items</button>
        </div>
      </details>
    {/if}
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
  .value input:not([type='checkbox']),
  .value select {
    width: 100%;
    padding: 3px 6px;
  }
  .vec {
    display: flex;
    gap: 3px;
  }
  .readonly {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #b9bdd0;
  }
  .extra {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .extra input[type='number'] {
    width: 70px;
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
</style>
