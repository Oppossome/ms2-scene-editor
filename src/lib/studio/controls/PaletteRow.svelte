<script lang="ts">
  import { getPalette } from '#lib/entities/character/build.js';
  import type { PickChannel } from '#lib/entities/character/appearance.js';
  import type { Dye } from '#lib/entities/character/tint.js';
  import type { PaletteColor } from '#lib/types.js';

  let {
    palette,
    value,
    channel,
    custom = false,
    onpick
  }: {
    palette: number;
    /** A palette row, or a custom `#rrggbb` colour. */
    value: Dye;
    channel?: PickChannel;
    /** Show a custom colour swatch after the palette's. */
    custom?: boolean;
    onpick: (value: Dye) => void;
  } = $props();

  let colors = $state.raw<PaletteColor[]>([]);

  $effect(() => {
    const id = palette;
    void getPalette(id).then((c) => {
      if (id === palette) colors = c;
    });
  });

  /** Swatch colour: the colour of one channel, or the row's display colour (the body palette shows its main colour). */
  const css = (c: PaletteColor) => {
    const argb = channel !== undefined ? c[`ch${channel}` as const] : palette === 1 ? c.ch0 : c.palette || c.ch0;
    return '#' + argb.replace(/^0x/i, '').slice(-6).toLowerCase();
  };

  const customValue = $derived(typeof value === 'string' ? value : undefined);
  /** The picker opens on the colour shown now, so a custom colour can start from a preset. */
  const pickerStart = $derived(
    customValue ?? (typeof value === 'number' && colors[value] ? css(colors[value]) : '#ffffff')
  );
</script>

<div class="swatches">
  {#each colors as color, i (color.sn)}
    <button
      class="swatch"
      class:on={value === i}
      style:background={css(color)}
      title={`Colour ${i}`}
      aria-label={`Colour ${i}`}
      onclick={() => onpick(i)}
    ></button>
  {/each}
  {#if custom && colors.length}
    <label
      class="swatch custom"
      class:on={customValue !== undefined}
      class:empty={customValue === undefined}
      style:background={customValue}
      title={customValue ? `Custom colour ${customValue}` : 'Custom colour'}
    >
      <input
        type="color"
        aria-label="Custom colour"
        value={pickerStart}
        onchange={(e) => onpick(e.currentTarget.value.toLowerCase())}
      />
    </label>
  {/if}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
  }
  .swatch.on {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }
  .custom {
    position: relative;
    cursor: pointer;
    box-sizing: border-box;
    border: 1px solid rgb(255 255 255 / 0.35);
  }
  .custom.empty {
    background: conic-gradient(#f44, #fd4, #4d4, #4df, #44f, #d4f, #f44);
  }
  .custom:focus-within {
    outline: 2px solid #8af;
    outline-offset: 1px;
  }
  .custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    padding: 0;
    border: 0;
  }
</style>
