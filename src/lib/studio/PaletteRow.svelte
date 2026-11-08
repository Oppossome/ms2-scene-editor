<script lang="ts">
  import { getPalette } from '#lib/character/build.js';
  import type { PaletteColor } from '#lib/types.js';

  let { palette, value, onpick }: { palette: number; value: number; onpick: (index: number) => void } = $props();

  let colors = $state.raw<PaletteColor[]>([]);

  $effect(() => {
    const id = palette;
    void getPalette(id).then((c) => {
      if (id === palette) colors = c;
    });
  });

  const css = (c: PaletteColor) => '#' + (palette === 1 ? c.ch0 : c.palette || c.ch0).replace(/^0x/i, '').slice(-6);
</script>

<div class="swatches">
  {#each colors as color, i}
    <button class="swatch" class:on={value === i} style:background={css(color)} title={`Colour ${i}`} aria-label={`Colour ${i}`} onclick={() => onpick(i)}></button>
  {/each}
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
</style>
