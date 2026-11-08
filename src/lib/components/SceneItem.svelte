<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { untrack } from 'svelte';
  import type { AnimationClip, Group, Object3D } from 'three';
  import { AnimationPlayer } from '#lib/assets/animation.js';
  import { instantiate, loadClips } from '#lib/assets/loader.js';
  import { bodyClipDir } from '#lib/assets/urls.js';
  import { buildRig } from '#lib/character/build.js';
  import { buildMap, type BuiltMap } from '#lib/maps/instancing.js';
  import type { CharacterRig } from '#lib/character/rig.js';
  import type { SceneObject } from '#lib/scene/model.js';
  import type { MapData } from '#lib/types.js';
  import type { SceneState } from '#lib/scene/store.svelte.js';

  let { obj, scene }: { obj: SceneObject; scene: SceneState } = $props();

  let model = $state.raw<Object3D | null>(null);
  let group = $state.raw<Group | undefined>();
  let player: AnimationPlayer | null = null;
  let embedded: AnimationClip[] = [];
  let rig: CharacterRig | null = null;
  let mapBuild: BuiltMap | null = null;
  let loadId = 0;

  // Reload the model only when what it shows changes, not when it moves.
  const modelKey = $derived(JSON.stringify([obj.kind, obj.glb, obj.mapId, obj.outfit]));

  function cleanup() {
    loadId++;
    scene.registerPlayer(obj.id, null);
    player?.dispose();
    player = null;
    rig?.dispose();
    rig = null;
    mapBuild?.dispose();
    mapBuild = null;
    model = null;
    embedded = [];
  }

  async function load() {
    const id = ++loadId;
    try {
      let names: string[] = [];
      if (obj.kind === 'character' && obj.outfit) {
        const built = await buildRig(obj.outfit);
        if (id !== loadId) return built.dispose();
        rig = built;
        player = new AnimationPlayer(built.root);
        model = built.root;
        const res = await fetch(`/api/clips?gender=${obj.outfit.gender}`);
        if (res.ok && id === loadId) names = await res.json();
      } else if (obj.kind === 'map' && obj.mapId) {
        const res = await fetch(`/api/maps/${obj.mapId}`);
        if (!res.ok) throw new Error(`map ${obj.mapId}: ${res.status}`);
        const data = (await res.json()) as MapData;
        if (id !== loadId) return;
        mapBuild = buildMap(data, { cancelled: () => id !== loadId });
        model = mapBuild.group;
      } else if (obj.glb) {
        const loaded = await instantiate(obj.glb);
        if (id !== loadId) return;
        embedded = loaded.animations;
        player = new AnimationPlayer(loaded.object);
        model = loaded.object;
        names = embedded.map((c) => c.name);
      }
      if (player) scene.registerPlayer(obj.id, player);
      scene.clipNames = { ...scene.clipNames, [obj.id]: names };
      // Give a freshly added NPC its idle animation.
      if (!obj.clip) {
        const idle = names.find((n) => /^idle/i.test(n));
        if (idle) scene.update(obj.id, { clip: idle }, false);
      }
      await playClip(obj.clip);
    } catch (e) {
      console.error(`Failed to load ${obj.name}`, e);
    }
  }

  async function playClip(name: string | undefined) {
    const p = player;
    if (!p) return;
    if (!name) return p.stop();
    if (obj.kind === 'character' && obj.outfit) {
      const clips = await loadClips(`${bodyClipDir(obj.outfit.gender)}/${name}.glb`);
      if (player === p && clips[0]) p.play(clips[0], true);
    } else {
      const clip = embedded.find((c) => c.name === name);
      if (clip) p.play(clip, true);
    }
  }

  $effect(() => {
    void modelKey;
    untrack(() => void load());
    return cleanup;
  });

  $effect(() => {
    const clip = obj.clip;
    untrack(() => void playClip(clip));
  });

  $effect(() => {
    scene.registerGroup(obj.id, group ?? null);
    return () => scene.registerGroup(obj.id, null);
  });

  useTask((delta) => player?.update(delta));
</script>

<T.Group
  bind:ref={group}
  position={obj.position}
  rotation={obj.rotation}
  scale={obj.scale}
  visible={obj.visible}
  onclick={(e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    scene.select(obj.id);
  }}
>
  {#if model}<T is={model} />{/if}
</T.Group>
