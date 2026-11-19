<script lang="ts">
  // The heart in a library heading: a key in a box with a hairline that narrows the view to what is hearted. It
  // is filled and red while the view is narrowed, and an outline while it is not. The albums and artists headings
  // use it, so both look the same.
  import { icons } from '../../design/icons';

  let { on, label, onToggle }: { on: boolean; label: string; onToggle: () => void } = $props();
</script>

<div class="slot">
  <button class="slot-key" class:lit={on} aria-pressed={on} title={label} aria-label={label} onclick={onToggle}><i class="icon" class:outline={!on}>{icons.heart}</i></button>
</div>

<style>
  /* The same box as the other keys in the library heading (Collection). */
  .slot {
    display: flex;
    flex: none;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
  }

  .slot-key {
    display: grid;
    place-items: center;
    width: 32px;
    height: 26px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    cursor: pointer;
  }

  .slot-key:not(.lit) .outline {
    color: var(--favorite-idle);
  }

  .slot-key.lit {
    color: var(--favorite);
  }

  @media (hover: hover) {
    .slot-key:hover {
      background: rgb(255 255 255 / 0.094);
    }
  }
</style>
