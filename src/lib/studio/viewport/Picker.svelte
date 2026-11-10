<script lang="ts">
  import { useThrelte } from '@threlte/core';
  import { Vector2 } from 'three';
  import type { SceneRuntime } from '#lib/scene/runtime.svelte.js';

  interface Props {
    runtime: SceneRuntime;
    /** True while the gizmo is in use, so a click on it is not a pick. */
    blocked: () => boolean;
    onpick: (id: string | null) => void;
    oncontext: (id: string | null, x: number, y: number) => void;
  }

  let { runtime, blocked, onpick, oncontext }: Props = $props();

  const { renderer, camera } = useThrelte();

  // Clicks pick; drags (orbit/pan) do not. A right click without movement opens the context menu.
  $effect(() => {
    const el = renderer.domElement;
    const ndc = new Vector2();
    let down: { x: number; y: number; button: number } | null = null;

    const toNdc = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.button !== e.button) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
      if (e.button === 0) {
        if (!blocked()) onpick(runtime.pick(toNdc(e), camera.current, e.altKey, e.ctrlKey));
      } else if (e.button === 2) {
        oncontext(runtime.pick(toNdc(e), camera.current, false, e.ctrlKey), e.clientX, e.clientY);
      }
    };
    const onContext = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    // Orbit controls capture the pointer, so the release is not always delivered to the canvas itself.
    window.addEventListener('pointerup', onUp, true);
    el.addEventListener('contextmenu', onContext);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('contextmenu', onContext);
    };
  });
</script>
