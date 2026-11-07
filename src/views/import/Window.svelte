<script lang="ts">
  // A window over the workbench, as the desktop's dialogs are. A whole page on a phone.
  import type { Snippet } from 'svelte';

  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: Snippet } = $props();

  // At the root of the page, because a pane's blur makes it the frame that fixed positions are measured from.
  function atRoot(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

<div class="veil" use:atRoot role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onClose()}>
  <div class="window" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h2 class="heading">{title}</h2>
      <button class="key" title={text('Common_Cancel')} aria-label={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.close}</i></button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(0 0 0 / 0.55);
  }

  .window {
    display: flex;
    flex-direction: column;
    width: min(640px, 100%);
    max-height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: 14px;
    background: var(--ground);
  }

  .window.wide {
    width: min(980px, 100%);
  }

  header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--hairline);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 14px 16px;
    overflow-y: auto;
  }

  @media (max-width: 699px) {
    .veil {
      padding: 0;
    }

    .window {
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 0;
    }

    header {
      padding-top: max(12px, env(safe-area-inset-top));
    }
  }
</style>
