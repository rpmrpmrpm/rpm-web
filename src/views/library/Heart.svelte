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

<button class="heart" class:on aria-pressed={on} title={label} aria-label={label} onclick={() => favorites.mark(track, !on)}><i class="icon">{icons.heart}</i></button>

<style>
  .heart {
    flex: none;
    padding: 4px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 12px;
    cursor: pointer;
  }

  .heart.on {
    color: var(--favorite);
  }
</style>
