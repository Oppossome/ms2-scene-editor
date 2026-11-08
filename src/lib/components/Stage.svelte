<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { interactivity, OrbitControls } from '@threlte/extras';
  import type { ViewApi } from './viewapi.js';
  import { untrack } from 'svelte';
  import { Box3, Vector3, type Object3D, type PerspectiveCamera } from 'three';
  import type { OrbitControls as OrbitControlsType } from 'three/addons/controls/OrbitControls.js';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Object to frame when it (or frameToken) changes. */
    object?: Object3D | null;
    frameToken?: number;
    grid?: boolean;
    gridSize?: number;
    onTick?: (delta: number) => void;
    /** Enable pointer picking on objects (click/hover events). */
    interactive?: boolean;
    /** Called when the empty ground is clicked. */
    onGroundClick?: () => void;
    viewApi?: ViewApi;
    children?: Snippet;
  }

  let {
    object = null,
    frameToken = 0,
    grid = true,
    gridSize = 1000,
    onTick,
    interactive = false,
    onGroundClick,
    viewApi,
    children
  }: Props = $props();

  if (untrack(() => interactive)) interactivity();

  let camera = $state<PerspectiveCamera>();
  let controls = $state<OrbitControlsType>();

  function frame(target: Object3D) {
    if (!camera || !controls) return;
    target.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 2.2;
    camera.position.set(center.x + dist * 0.35, center.y + dist * 0.2, center.z + dist);
    controls.target.copy(center);
    controls.update();
  }

  $effect(() => {
    void frameToken;
    if (object && camera && controls) frame(object);
  });

  $effect(() => {
    if (viewApi) {
      viewApi.target = () => controls?.target;
      viewApi.frame = (o) => frame(o);
    }
  });

  useTask((delta) => onTick?.(delta));
</script>

<T.PerspectiveCamera makeDefault position={[150, 120, 350]} fov={40} near={1} far={200000} bind:ref={camera}>
  <OrbitControls enableDamping dampingFactor={0.12} bind:ref={controls} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={1.4} />
<T.HemisphereLight args={[0xffffff, 0x555566, 1.0]} />
<T.DirectionalLight position={[300, 700, 500]} intensity={2.4} />

{#if grid}
  <T.GridHelper args={[gridSize, gridSize / 50, 0x555a70, 0x2c2f3d]} />
{/if}

{#if onGroundClick}
  <T.Mesh rotation.x={-Math.PI / 2} onclick={onGroundClick}>
    <T.PlaneGeometry args={[200000, 200000]} />
    <T.MeshBasicMaterial transparent opacity={0} depthWrite={false} />
  </T.Mesh>
{/if}

{@render children?.()}
