<script lang="ts">
  import type { Studio } from '../controller.svelte.js';

  let { studio }: { studio: Studio } = $props();

  /** Each binding is one or more alternatives (joined by "or"), and each alternative is a chord of keys joined by "+". */
  const GROUPS: { title: string; rows: { action: string; keys: string[][] }[] }[] = [
    {
      title: 'Editing',
      rows: [
        { action: 'Undo', keys: [['Ctrl', 'Z']] },
        {
          action: 'Redo',
          keys: [
            ['Ctrl', 'Shift', 'Z'],
            ['Ctrl', 'Y']
          ]
        },
        { action: 'Duplicate', keys: [['Ctrl', 'D']] },
        { action: 'Group', keys: [['Ctrl', 'G']] },
        { action: 'Delete', keys: [['Delete'], ['Backspace']] },
        { action: 'Rename', keys: [['F2']] },
        { action: 'Deselect', keys: [['Esc']] },
        { action: 'Open Toolbox', keys: [['I']] }
      ]
    },
    {
      title: 'Transform and view',
      rows: [
        { action: 'Move', keys: [['G']] },
        { action: 'Rotate', keys: [['R']] },
        { action: 'Scale', keys: [['T']] },
        { action: 'Focus selection', keys: [['F']] },
        { action: 'Select top-level ancestor', keys: [['Alt', 'Click']] },
        { action: 'Select through hierarchy locks', keys: [['Ctrl', 'Click']] }
      ]
    },
    {
      title: 'Animation',
      rows: [
        { action: 'Previous / next frame', keys: [[','], ['.']] },
        {
          action: 'Previous / next 10 frames',
          keys: [
            ['Shift', ','],
            ['Shift', '.']
          ]
        }
      ]
    },
    {
      title: 'Flying camera',
      rows: [
        { action: 'Forward / back (look direction)', keys: [['W'], ['S']] },
        { action: 'Strafe left / right', keys: [['A'], ['D']] },
        { action: 'Rise', keys: [['E']] },
        { action: 'Descend', keys: [['Q']] }
      ]
    }
  ];

  function close() {
    studio.showKeybinds = false;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="overlay" role="presentation" onpointerdown={close}>
  <div
    class="dialog"
    role="dialog"
    aria-labelledby="keybinds-title"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <header>
      <strong id="keybinds-title">Keybinds</strong>
      <button onclick={close} aria-label="Close">&times;</button>
    </header>
    <div class="body">
      {#each GROUPS as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <table>
            <tbody>
              {#each group.rows as row (row.action)}
                <tr>
                  <td>{row.action}</td>
                  <td class="keys">
                    {#each row.keys as chord, i (i)}
                      {#if i > 0}<span class="or">or</span>{/if}
                      {#each chord as key, j (j)}
                        {#if j > 0}<span class="plus">+</span>{/if}
                        <kbd>{key}</kbd>
                      {/each}
                    {/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/each}
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
    width: min(520px, 92vw);
    max-height: 86vh;
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
    overflow-y: auto;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 4px 0;
    vertical-align: middle;
  }
  td.keys {
    text-align: right;
    white-space: nowrap;
  }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 2px 6px;
    font:
      12px ui-monospace,
      SFMono-Regular,
      Menlo,
      Consolas,
      monospace;
    text-align: center;
    color: var(--text, #e6e8f0);
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .plus,
  .or {
    margin: 0 4px;
    color: #8b90a3;
    font-size: 12px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
</style>
