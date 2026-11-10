<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { interactivity, OrbitControls } from '@threlte/extras';
  import type { ViewApi } from './viewapi.js';
  import { untrack } from 'svelte';
  import { Box3, Vector3, type Fog, type Object3D, type PerspectiveCamera } from 'three';
  import { FLY_KEYS } from './camera-keys.js';
  import { fogColor, fogRange, type FogSpec } from './fog.js';
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
    canFly: () => boolean;
    /** Distance fog, measured for the game camera. */
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
    canFly,
    fog = null,
    children
  }: Props = $props();

  if (untrack(() => interactive)) interactivity();

  let camera = $state<PerspectiveCamera>();
  let controls = $state<OrbitControlsType>();

  function frame(target: Object3D | Box3) {
    if (!camera || !controls) return;
    if (!(target instanceof Box3)) target.updateWorldMatrix(true, true);
    const box = target instanceof Box3 ? target : new Box3().setFromObject(target);
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

  let fogRef = $state<Fog>();

  // All stages track held keys; only the view under the pointer (or the main fallback) moves.
  const held = new Set<string>();
  const look = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const UP = new Vector3(0, 1, 0);

  function onKeyDown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const key = e.key.toLowerCase();
    if (!Object.hasOwn(FLY_KEYS, key)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    held.add(key);
  }

  function onKeyUp(e: KeyboardEvent) {
    held.delete(e.key.toLowerCase());
  }

  function fly(delta: number) {
    if (!camera || !controls || held.size === 0 || !canFly()) return;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const key of held) {
      const dir = FLY_KEYS[key];
      x += dir.x;
      y += dir.y;
      z += dir.z;
    }
    if (x === 0 && y === 0 && z === 0) return;

    camera.getWorldDirection(look);
    // Strafing stays level, so A/D never climb; W/S follow the full look vector.
    forward.copy(look).setY(0).normalize();
    right.crossVectors(forward, UP).normalize();
    // E and Q move along the camera's own up, which tilts with the view.
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    // Speed scales with the distance to the target, so close and far views both feel usable.
    const distance = Math.max(camera.position.distanceTo(controls.target), 20);
    const step = look
      .clone()
      .multiplyScalar(z)
      .addScaledVector(right, x)
      .addScaledVector(up, y)
      .normalize()
      .multiplyScalar(distance * 1.2 * delta);
    camera.position.add(step);
    controls.target.add(step);
  }

  // The fog distances are measured for the game camera, so they follow how far the view is from its target.
  useTask((delta) => {
    onTick?.(delta);
    fly(delta);
    if (fog && fogRef && camera && controls) {
      const range = fogRange(fog, camera.position.distanceTo(controls.target));
      fogRef.near = range.near;
      fogRef.far = range.far;
    }
  });
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={() => held.clear()} />

<T.PerspectiveCamera makeDefault position={[150, 120, 350]} fov={40} near={1} far={200000} bind:ref={camera}>
  <OrbitControls enableDamping dampingFactor={0.12} bind:ref={controls} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={1.4} />
<T.HemisphereLight args={[0xffffff, 0x555566, 1.0]} />
<T.DirectionalLight position={[300, 700, 500]} intensity={2.4} />

{#if fog}
  <T.Fog attach="fog" args={[fogColor(fog.color), fog.near, fog.far]} bind:ref={fogRef} />
{/if}

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
