<script lang="ts">
  // The record mark at the end of a row whose field is true of the whole album (the desktop's AlbumMarker). It
  // turns amber when the other tracks do not hold the value in the box, and says what they hold. In the track
  // editor it is also a switch: on, the value is written to every track of the album. In the album editor
  // everything is written to every track, so it only reports.
  import { icons } from '../../design/icons';
  import { text } from '../../strings/loc';

  let { disagreement = null, armed = $bindable(), canArm = false }: { disagreement?: string | null; armed?: boolean; canArm?: boolean } = $props();

  const tip = $derived(armed ? text('Edit_WillApplyToAlbum') : (disagreement ?? (canArm ? text('Edit_ApplyToAlbum') : '')));
</script>

{#if canArm}
  <button class="marker" class:armed class:disagrees={!!disagreement} type="button" title={tip} aria-label={tip} aria-pressed={armed} onclick={() => (armed = !armed)}>
    <i class="icon">{icons.album}</i>
  </button>
{:else}
  <span class="marker" class:disagrees={!!disagreement} title={tip || undefined} role={tip ? 'img' : undefined} aria-label={tip || undefined}>
    <i class="icon">{icons.album}</i>
  </span>
{/if}

<style>
  .marker {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.25);
    font-size: 11px;
  }

  button.marker {
    cursor: pointer;
  }

  .marker.disagrees {
    color: #ffc061;
  }

  .marker.armed {
    color: #04c8ff;
  }
</style>
