<script lang="ts">
  let {
    value,
    step = 1,
    label = '',
    min,
    disabled = false,
    onstart,
    onchange
  }: {
    value: number;
    step?: number;
    label?: string;
    min?: number;
    disabled?: boolean;
    /** Called once before an edit begins (typing or the start of a drag), e.g. to record undo history. */
    onstart?: () => void;
    onchange: (value: number) => void;
  } = $props();

  const clean = (n: number) => Math.round(n * 1000) / 1000;
  const clamp = (n: number) => (min !== undefined ? Math.max(min, n) : n);

  let drag: { x: number; start: number; moved: boolean } | null = null;

  function down(e: PointerEvent) {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, start: value, moved: false };
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 3) return;
      drag.moved = true;
      onstart?.();
    }
    onchange(clamp(clean(drag.start + dx * step * (e.shiftKey ? 0.05 : 0.5))));
  }

  function up() {
    drag = null;
  }
</script>

<label class="num" class:disabled>
  {#if label}
    <span class="axis" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>{label}</span>
  {/if}
  <input
    type="number"
    {step}
    {min}
    {disabled}
    value={clean(value)}
    onchange={(e) => {
      const v = e.currentTarget.valueAsNumber;
      if (Number.isNaN(v)) return;
      onstart?.();
      onchange(clamp(v));
    }}
  />
</label>

<style>
  .num {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .num:focus-within {
    border-color: var(--accent);
  }
  .axis {
    padding: 0 5px;
    color: var(--muted);
    font-size: 11px;
    cursor: ew-resize;
    user-select: none;
    touch-action: none;
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    border: none;
    background: transparent;
    padding: 3px 4px;
    text-align: right;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .disabled {
    opacity: 0.5;
  }
</style>
