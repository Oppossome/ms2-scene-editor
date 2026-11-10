<script lang="ts">
  import type { Studio } from '../controller.svelte.js';

  let { studio }: { studio: Studio } = $props();

  const REPO_URL = 'https://github.com/Oppossome/ms2-scene-editor';

  function close() {
    studio.showAbout = false;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" onpointerdown={close}>
  <div class="dialog" role="dialog" aria-labelledby="about-title" tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
    <header>
      <strong id="about-title">About</strong>
      <button onclick={close} aria-label="Close">&times;</button>
    </header>
    <div class="body">
      <p>
        MS2SceneEditor is a scene editor for the discontinued game MapleStory 2. It lets you dress characters, build scenes from the game's
        maps, props and NPCs, pose and animate them, and export the result.
      </p>
      <p class="ai">
        <strong>Made with the heavy assistance of AI.</strong> Most of this project, including the asset extraction and conversion tools and this
        editor, was written together with an AI coding assistant. It has not had the review that a hand-written project would. Expect rough edges and
        mistakes, and check anything that matters.
      </p>
      <p>This is an unofficial fan project. It is not affiliated with or endorsed by Nexon.</p>
      <p>
        Source code: <a href={REPO_URL} target="_blank" rel="noopener noreferrer">github.com/Oppossome/ms2-scene-editor</a>
      </p>
    </div>
    <footer><button onclick={close}>Close</button></footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(480px, 92vw);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  header button {
    border: none;
    background: transparent;
    font-size: 20px;
    line-height: 1;
    padding: 2px 8px;
  }
  .body {
    padding: 4px 14px 8px;
    line-height: 1.5;
  }
  .ai {
    padding: 8px 10px;
    border-left: 3px solid var(--accent);
    background: var(--panel-2);
    border-radius: 0 4px 4px 0;
  }
  .body a {
    color: var(--accent);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
</style>
