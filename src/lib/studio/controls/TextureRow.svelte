<script lang="ts">
  import { getUserTexture, putUserTexture, userTextureUrl, validateImage } from '#lib/assets/user-textures.js';
  import type { ItemTexture } from '#lib/entities/character/texture-override.js';
  import { downloadBlob } from '#lib/export/glb.js';

  let {
    textures,
    value,
    onchange,
    onerror
  }: {
    /** The item's own colour maps. */
    textures: ItemTexture[];
    /** Texture key -> id of the user's image. */
    value: Record<string, string>;
    onchange: (next: Record<string, string>) => void;
    onerror: (message: string) => void;
  } = $props();

  /** Object URLs of the user's images, for the thumbnails. */
  let shown = $state<Record<string, string>>({});
  let busy = $state('');
  /** The card an image is being dragged over. */
  let dropping = $state('');
  let picker = $state<HTMLInputElement>();
  /** The texture the file picker was opened for. */
  let target: ItemTexture | undefined;

  $effect(() => {
    for (const id of Object.values(value)) {
      if (shown[id]) continue;
      void userTextureUrl(id).then((url) => {
        if (url) shown = { ...shown, [id]: url };
      });
    }
  });

  const stem = (key: string) => key.replace(/\.[^.]+$/, '');
  const extension = (type: string) => (type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png');

  async function downloadOriginal(texture: ItemTexture) {
    try {
      const response = await fetch(texture.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      downloadBlob(await response.blob(), texture.key);
    } catch (error) {
      onerror(`Could not download ${texture.key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async function downloadMine(texture: ItemTexture) {
    const blob = await getUserTexture(value[texture.key]);
    if (!blob) return onerror(`${texture.key}: the image is not stored in this browser.`);
    downloadBlob(blob, `${stem(texture.key)}_custom.${extension(blob.type)}`);
  }

  function choose(texture: ItemTexture) {
    if (busy) return;
    target = texture;
    picker?.click();
  }

  async function replace(texture: ItemTexture, file: File | undefined) {
    if (!file || busy) return;
    busy = texture.key;
    try {
      await validateImage(file);
      const id = await putUserTexture(file);
      onchange({ ...value, [texture.key]: id });
    } catch (error) {
      onerror(`Could not use ${file.name}: ${error instanceof Error ? error.message : error}`);
    } finally {
      busy = '';
    }
  }

  function reset(texture: ItemTexture) {
    const { [texture.key]: _removed, ...rest } = value;
    onchange(rest);
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
</script>

{#snippet icon(paths: string[])}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each paths as d (d)}<path {d} />{/each}
  </svg>
{/snippet}

<ul class="textures">
  {#each textures as texture (texture.key)}
    {@const mine = value[texture.key]}
    <li
      class:mine={!!mine}
      class:dropping={dropping === texture.key}
      ondragover={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dropping = texture.key;
      }}
      ondragleave={() => {
        if (dropping === texture.key) dropping = '';
      }}
      ondrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dropping = '';
        void replace(texture, e.dataTransfer?.files[0]);
      }}
    >
      <button
        class="preview"
        onclick={() => choose(texture)}
        disabled={!!busy}
        title={`${texture.key}: click or drop an image here to replace it`}
        aria-label={`Replace ${texture.key}`}
      >
        {#if !mine || shown[mine]}
          <img src={mine ? shown[mine] : texture.url} alt="" />
        {/if}
        {#if mine}<span class="badge">Custom</span>{/if}
        <span class="overlay" aria-hidden="true">
          {#if busy === texture.key}
            <span class="spinner"></span>
          {:else}
            {@render icon(['M12 15V4', 'm7 9 5-5 5 5', 'M5 20h14'])}
            {dropping === texture.key ? 'Drop to replace' : 'Replace'}
          {/if}
        </span>
      </button>
      <div class="actions">
        <button onclick={() => downloadOriginal(texture)} title="Download the original to edit it">
          {@render icon(['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'])}
        </button>
        <button onclick={() => choose(texture)} disabled={!!busy} title="Replace with your image (PNG, JPEG, WebP)">
          {@render icon(['M12 15V4', 'm7 9 5-5 5 5', 'M5 20h14'])}
        </button>
        {#if mine}
          <button onclick={() => downloadMine(texture)} title="Download your image">
            {@render icon(['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'])}
          </button>
          <button onclick={() => reset(texture)} title="Back to the original">
            {@render icon(['M4 4v6h6', 'M4.5 15a8 8 0 1 0 1.9-8.3L4 10'])}
          </button>
        {/if}
      </div>
    </li>
  {/each}
</ul>
<input
  class="picker"
  type="file"
  accept="image/png,image/jpeg,image/webp"
  bind:this={picker}
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (target) void replace(target, file);
  }}
/>

<style>
  .textures {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .preview {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    overflow: hidden;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: repeating-conic-gradient(#2e3140 0 25%, #252835 0 50%) 0 0 / 12px 12px;
  }
  li.mine .preview {
    border-color: var(--accent);
  }
  li.dropping .preview {
    border: 2px dashed var(--accent);
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .badge {
    position: absolute;
    top: 4px;
    left: 4px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: rgb(10 12 18 / 0.6);
    color: #fff;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .preview:hover:not(:disabled) .overlay,
  .preview:focus-visible .overlay,
  li.dropping .overlay,
  .overlay:has(.spinner) {
    opacity: 1;
  }
  .overlay svg {
    width: 20px;
    height: 20px;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid #fff6;
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .actions {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .actions button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--panel-2);
    color: var(--muted);
  }
  .actions button + button {
    border-left: 1px solid var(--border);
  }
  .actions button:hover:not(:disabled) {
    color: inherit;
    background: color-mix(in srgb, var(--accent) 18%, var(--panel-2));
  }
  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .picker {
    display: none;
  }
</style>
