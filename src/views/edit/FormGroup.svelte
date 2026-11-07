<script lang="ts">
  // A named group of rows: the group's name over a thin rule, then rows of [tick] [label] [box] [marker] on a
  // 24 px pitch (the desktop's DenseFormGroup). The label column has a fixed width, so every box in a window
  // starts on the same line, and an empty or odd value shows as a break in it.
  import type { Snippet } from 'svelte';

  import { text } from '../../strings/loc';

  let { heading, ticks = false, children }: { heading: string; ticks?: boolean; children: Snippet } = $props();
</script>

<section class="group">
  <h3>{text(heading)}</h3>
  <div class="rows" class:ticks>
    {@render children()}
  </div>
</section>

<style>
  h3 {
    margin: 0;
    padding-bottom: 3px;
    border-bottom: 1px solid rgb(255 255 255 / 0.122);
    margin-bottom: 5px;
    color: rgb(255 255 255 / 0.45);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .rows {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr) 20px;
    gap: 6px 8px;
    align-items: center;
  }

  .rows.ticks {
    grid-template-columns: auto 82px minmax(0, 1fr) 20px;
  }
</style>
