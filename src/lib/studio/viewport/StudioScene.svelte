<script lang="ts">
  import { T } from '@threlte/core';
  import { TransformControls } from '@threlte/extras';
  import type { Studio } from '../controller.svelte.js';
  import Picker from './Picker.svelte';

  let { studio }: { studio: Studio } = $props();

  const store = $derived(studio.store);
  const runtime = $derived(studio.runtime);

  const selected = $derived(store.selected);
  // Read the version so the gizmo re-attaches when models (re)load.
  const target = $derived.by(() => {
    void runtime.version;
    return selected && selected.visible && !selected.locked ? runtime.objectOf(selected.id) : undefined;
  });

  /** Copy the dragged object's local transform back into the node. */
  function syncSelected() {
    const o = target;
    const id = store.selectedId;
    if (!o || !id) return;
    store.update(
      id,
      {
        position: [o.position.x, o.position.y, o.position.z],
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
        scale: [o.scale.x, o.scale.y, o.scale.z]
      },
      false
    );
  }
</script>

<T is={runtime.root} />
<T is={runtime.overlay} />

<Picker
  {runtime}
  blocked={() => studio.gizmoActive}
  onpick={(id) => store.select(id)}
  oncontext={(id, x, y) => {
    if (id) store.select(id);
    studio.openMenu(x, y, id ? { type: 'node', id } : { type: 'empty' });
  }}
/>

{#if target}
  <!--
    Keyed so every target gets a fresh TransformControls. When Threlte re-attaches an existing one it ends up
    re-running its attach effect on every drag start, which detaches the gizmo mid-drag and kills the drag.
  -->
  {#key target}
    <TransformControls
      object={target}
      mode={store.mode}
      space={store.space}
      translationSnap={store.snap ? 10 : undefined}
      rotationSnap={store.snap ? Math.PI / 12 : undefined}
      scaleSnap={store.snap ? 0.1 : undefined}
      onmouseDown={() => {
        studio.gizmoActive = true;
        store.beginGesture();
      }}
      onmouseUp={() => {
        store.endGesture();
        setTimeout(() => (studio.gizmoActive = false), 0);
      }}
      onobjectChange={syncSelected}
    />
  {/key}
{/if}
