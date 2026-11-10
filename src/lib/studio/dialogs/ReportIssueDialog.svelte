<script lang="ts">
  import type { Studio } from '../controller.svelte.js';

  let { studio }: { studio: Studio } = $props();

  const ISSUES_URL = 'https://github.com/Oppossome/ms2-scene-editor/issues/';

  function close() {
    studio.showReportIssue = false;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" onpointerdown={close}>
  <div
    class="dialog"
    role="dialog"
    aria-labelledby="report-title"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <header>
      <strong id="report-title">Report an issue</strong>
      <button onclick={close} aria-label="Close">&times;</button>
    </header>
    <div class="body">
      <p class="weekend">
        <strong>This is a weekend project.</strong> I can't make any guarantees about how quickly issues will be looked at
        or fixed.
      </p>
      <p>Bug reports and suggestions are still welcome on the issue tracker.</p>
    </div>
    <footer>
      <button onclick={close}>Cancel</button>
      <a class="open" href={ISSUES_URL} target="_blank" rel="noopener noreferrer" onclick={close}>Open issues</a>
    </footer>
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
  .weekend {
    padding: 8px 10px;
    border-left: 3px solid var(--accent);
    background: var(--panel-2);
    border-radius: 0 4px 4px 0;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
  .open {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--accent);
    text-decoration: none;
  }
</style>
