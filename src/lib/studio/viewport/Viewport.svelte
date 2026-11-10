<script lang="ts">
  import { Canvas } from '@threlte/core';
  import type { Object3D } from 'three';
  import { onDestroy, type Snippet } from 'svelte';
  import Stage from './Stage.svelte';
  import { cameraFocus } from './camera-focus.js';
  import { assetUrl } from '../../assets/urls.js';
  import type { FogSpec } from './fog.js';
  import type { ViewApi } from './viewapi.js';

  interface Props {
    object?: Object3D | null;
    frameToken?: number;
    grid?: boolean;
    gridSize?: number;
    onTick?: (delta: number) => void;
    interactive?: boolean;
    onGroundClick?: () => void;
    viewApi?: ViewApi;
    /** Receives camera movement when the pointer is outside every viewport. */
    main?: boolean;
    /** Painted backdrop behind the scene, a path under `converted/textures`. */
    background?: string;
    /** Distance fog, measured for the game camera (see `fogRange`). */
    fog?: FogSpec | null;
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
    main = false,
    background,
    fog = null,
    children
  }: Props = $props();

  const view = Symbol();
  onDestroy(() => cameraFocus.leave(view));
</script>

<div
  class="viewport"
  role="region"
  aria-label={main ? 'Scene viewport' : 'Preview viewport'}
  class:backdrop={!!background}
  style:background-image={background ? `url("${assetUrl(`converted/textures/${background}`)}")` : undefined}
  onpointerenter={() => cameraFocus.enter(view)}
  onpointerleave={() => cameraFocus.leave(view)}
>
  <Canvas>
    <Stage
      {object}
      {frameToken}
      {grid}
      {gridSize}
      {onTick}
      {interactive}
      {onGroundClick}
      {viewApi}
      {fog}
      canFly={() => cameraFocus.isActive(view, main)}
    >
      {@render children?.()}
    </Stage>
  </Canvas>
</div>

<style>
  .viewport {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at 50% 30%, #3a3f55, #1b1d26);
  }
  .viewport.backdrop {
    background-size: cover;
    background-position: center;
  }
</style>
