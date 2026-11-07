<script lang="ts">
  // One row of a group: an optional tick, the label, the box, and whatever stands at the end of the row.
  import type { Snippet } from 'svelte';

  let { label, top = false, tick, children, trailing }: { label: string; top?: boolean; tick?: Snippet; children: Snippet; trailing?: Snippet } = $props();
</script>

<div class="row" class:top>
  {#if tick}<span class="tick">{@render tick()}</span>{/if}
  <span class="label" title={label}>{label}</span>
  <div class="box">{@render children()}</div>
  <span class="end">{@render trailing?.()}</span>
</div>

<style>
  .row {
    display: contents;
  }

  .label {
    overflow: hidden;
    color: rgb(255 255 255 / 0.65);
    font-size: 11.5px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tick {
    display: flex;
    align-items: center;
  }

  .box {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  .row.top .label,
  .row.top .tick {
    align-self: start;
    margin-top: 4px;
  }

  .end {
    display: grid;
    place-items: center;
  }
</style>
