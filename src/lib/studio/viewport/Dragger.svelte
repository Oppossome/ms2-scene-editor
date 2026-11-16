<script lang="ts">
  import { useThrelte } from '@threlte/core';
  import { Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
  import type { SceneRuntime } from '#lib/scene/runtime.svelte.js';
  import type { SceneState } from '#lib/scene/store.svelte.js';
  import { getOrbitControls } from './orbit-context.js';

  interface Props {
    runtime: SceneRuntime;
    store: SceneState;
    /** The object the gizmo drives for the selection, if it can be moved. */
    target: () => Object3D | undefined;
    /** True while the pointer is over (or using) a gizmo handle, which takes the press instead. */
    blocked: () => boolean;
    onstart: () => void;
    onend: () => void;
  }

  let { runtime, store, target, blocked, onstart, onend }: Props = $props();

  const { renderer, camera } = useThrelte();
  const orbitControls = getOrbitControls();

  /** Pixels the pointer must travel before a press on the selection becomes a drag (matches the click threshold). */
  const THRESHOLD = 4;
  const SNAP = 10;

  /** Whether `id` is the selected node or lies inside it, so pressing a character's item drags the character. */
  function withinSelection(id: string): boolean {
    const selectedId = store.selectedId;
    for (let current = store.node(id); current; current = store.node(current.parentId)) {
      if (current.id === selectedId) return true;
    }
    return false;
  }

  // Pressing the selected node and moving the pointer slides it along the ground; Shift slides it up and down.
  $effect(() => {
    const el = renderer.domElement;
    // Listen on the parent in the capture phase so this runs before OrbitControls and can keep it from orbiting.
    const host = el.parentElement ?? el;
    const ndc = new Vector2();
    const raycaster = new Raycaster();
    const plane = new Plane();
    const hit = new Vector3();
    const world = new Vector3();
    const normal = new Vector3();

    let drag: {
      pointerId: number;
      id: string;
      object: Object3D;
      x: number;
      y: number;
      vertical: boolean;
      /** Object world position minus the plane point under the pointer at the start. */
      offset: Vector3;
      started: boolean;
    } | null = null;

    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const ray = (e: PointerEvent) => {
      raycaster.setFromCamera(toNdc(e), camera.current);
      return raycaster.ray;
    };

    const setOrbit = (enabled: boolean) => {
      const controls = orbitControls();
      if (controls) controls.enabled = enabled;
    };

    const onDown = (e: PointerEvent) => {
      if (e.target !== el || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (drag || blocked()) return;
      const object = target();
      const id = store.selectedId;
      if (!object || !id) return;
      const picked = runtime.pick(toNdc(e), camera.current);
      if (!picked || !withinSelection(picked)) return;

      object.updateWorldMatrix(true, false);
      object.getWorldPosition(world);
      const vertical = e.shiftKey;
      if (vertical) {
        // A vertical plane through the object facing the camera.
        camera.current.getWorldDirection(normal).setY(0);
        if (normal.lengthSq() < 1e-6) return;
        plane.setFromNormalAndCoplanarPoint(normal.normalize(), world);
      } else {
        plane.setFromNormalAndCoplanarPoint(normal.set(0, 1, 0), world);
      }
      if (!ray(e).intersectPlane(plane, hit)) return;

      setOrbit(false);
      drag = {
        pointerId: e.pointerId,
        id,
        object,
        x: e.clientX,
        y: e.clientY,
        vertical,
        offset: world.clone().sub(hit),
        started: false
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= THRESHOLD) return;
        drag.started = true;
        store.beginGesture();
        onstart();
        el.style.cursor = 'grabbing';
      }
      if (!ray(e).intersectPlane(plane, hit)) return;
      const { object, offset } = drag;
      object.getWorldPosition(world);
      if (drag.vertical) {
        world.y = hit.y + offset.y;
        if (store.snap) world.y = Math.round(world.y / SNAP) * SNAP;
      } else {
        world.x = hit.x + offset.x;
        world.z = hit.z + offset.z;
        if (store.snap) {
          world.x = Math.round(world.x / SNAP) * SNAP;
          world.z = Math.round(world.z / SNAP) * SNAP;
        }
      }
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        object.parent.worldToLocal(world);
      }
      object.position.copy(world);
      store.update(drag.id, { position: [world.x, world.y, world.z] }, false);
    };

    const stop = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setOrbit(true);
      if (drag?.started) {
        store.endGesture();
        el.style.cursor = '';
        // Let the release's click handling see the drag before it ends.
        setTimeout(onend, 0);
      }
      drag = null;
    };

    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) stop();
    };

    host.addEventListener('pointerdown', onDown, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      if (drag) stop();
    };
  });
</script>
