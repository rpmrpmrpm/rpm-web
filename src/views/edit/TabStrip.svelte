<script lang="ts">
  // The tabs of an edit window: the left pane's function rail laid on its side, as the desktop's RailTabStrip.
  // The tabs sit edge to edge, and the chosen one wears the azure wash of a chosen segment.
  import { text } from '../../strings/loc';
  import type { Tab } from './form';

  let { tabs, current = $bindable() }: { tabs: readonly Tab[]; current: string } = $props();
</script>

<div class="strip" role="tablist">
  {#each tabs as tab (tab.id)}
    <button role="tab" aria-selected={current === tab.id} class:on={current === tab.id} onclick={() => (current = tab.id)}>
      <i class="icon">{tab.glyph}</i>{text(tab.label)}
    </button>
  {/each}
</div>

<style>
  .strip {
    display: inline-flex;
    flex-wrap: wrap;
    align-self: flex-start;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 8px;
    background: rgb(0 0 0 / 0.133);
  }

  button {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    height: 36px;
    padding: 0 14px;
    border: 0;
    background: transparent;
    color: rgb(255 255 255 / 0.8);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }

  button .icon {
    font-size: 13px;
  }

  button.on {
    background: var(--selected);
    color: #fff;
  }

  @media (hover: hover) {
    button:not(.on):hover {
      background: rgb(255 255 255 / 0.094);
      color: #fff;
    }
  }

  @media (max-width: 699px) {
    .strip {
      flex-wrap: nowrap;
      max-width: 100%;
      overflow-x: auto;
    }

    button {
      flex: none;
      padding: 0 11px;
    }
  }
</style>
