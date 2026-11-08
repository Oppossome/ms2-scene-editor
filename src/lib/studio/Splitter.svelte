<script lang="ts">
  /** A draggable divider. `onresize` gets the pointer movement in pixels along the axis. */
  let { axis, onresize }: { axis: 'x' | 'y'; onresize: (delta: number) => void } = $props();

  let last = 0;
  let active = $state(false);

  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    last = axis === 'x' ? e.clientX : e.clientY;
    active = true;
  }

  function move(e: PointerEvent) {
    if (!active) return;
    const now = axis === 'x' ? e.clientX : e.clientY;
    onresize(now - last);
    last = now;
  }
</script>

<div
  class="splitter {axis}"
  class:active
  role="separator"
  aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (active = false)}
  onpointercancel={() => (active = false)}
></div>

<style>
  .splitter {
    flex: none;
    background: var(--border);
    touch-action: none;
  }
  .splitter.x {
    width: 5px;
    cursor: col-resize;
  }
  .splitter.y {
    height: 5px;
    cursor: row-resize;
  }
  .splitter:hover,
  .splitter.active {
    background: var(--accent);
  }
</style>
