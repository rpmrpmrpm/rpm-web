<script lang="ts">
  // A song's favourite mark. It shows at once, and goes back if the store refuses it.
  import type { CloudTrack } from '../../api/wire';
  import { favorites } from '../../app';
  import { icons } from '../../design/icons';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { track }: { track: CloudTrack } = $props();

  const on = $derived.by(() => {
    void library.marksVersion;
    return favorites.marks.isMarked(track.rpmId);
  });
  const label = $derived(text(on ? 'Track_UnsetFavorite' : 'Track_SetFavorite'));
</script>

<button class="heart" class:on aria-pressed={on} title={label} aria-label={label} onclick={() => favorites.mark(track, !on)}><i class="icon" class:outline={!on}>{icons.heart}</i></button>

<style>
  .heart {
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--favorite-idle);
    font-size: 11px;
    cursor: pointer;
  }

  .heart.on {
    color: var(--favorite);
  }

  @media (hover: hover) {
    .heart:hover {
      background: rgb(255 255 255 / 0.133);
    }
  }
</style>
