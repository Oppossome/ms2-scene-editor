<script lang="ts">
  import { FRAME_RATE } from '#lib/scene/model.js';

  let {
    frame,
    max,
    live,
    onstart,
    onend,
    onscrub,
    onresume
  }: {
    /** The frame the animation is held on; undefined while it plays. */
    frame?: number;
    /** The clip's last frame. */
    max: number;
    /** The frame the animation is on right now, polled while it plays. */
    live: () => number;
    /** A drag begins: record the undo step. */
    onstart: () => void;
    onend?: () => void;
    /** Hold the animation on a frame; `dragging` when the drag already recorded its undo step. */
    onscrub: (frame: number, dragging: boolean) => void;
    /** Let the animation play again from the held frame. */
    onresume: () => void;
  } = $props();

  let liveFrame = $state(0);
  let dragging = false;

  $effect(() => {
    if (frame !== undefined) return;
    let raf = 0;
    const tick = () => {
      liveFrame = live();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  const shown = $derived(Math.min(frame ?? liveFrame, max));
</script>

<div class="scrub">
  <input
    type="range"
    min="0"
    {max}
    step="1"
    value={shown}
    aria-label="Frame"
    onpointerdown={() => {
      dragging = true;
      onstart();
    }}
    onpointerup={() => { dragging = false; onend?.(); }}
    onpointercancel={() => { dragging = false; onend?.(); }}
    oninput={(e) => onscrub(e.currentTarget.valueAsNumber, dragging)}
  />
  <div class="info">
    <span class="readout" title="Frame / last frame, at {FRAME_RATE} frames per second">
      {shown} / {max} · {(shown / FRAME_RATE).toFixed(2)} s
    </span>
    {#if frame !== undefined}
      <button class="resume" title="Let the animation play again from this frame" onclick={onresume}>Resume</button>
    {:else}
      <span class="hint">drag to pause</span>
    {/if}
  </div>
</div>

<style>
  .scrub {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-width: 0;
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--accent, #6c8cff);
  }
  .readout {
    color: var(--muted);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .hint {
    color: var(--muted);
    font-size: 0.8em;
    opacity: 0.7;
  }
  .resume {
    padding: 1px 8px;
    font-size: 0.85em;
  }
</style>
