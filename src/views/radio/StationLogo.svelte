<script lang="ts">
  // A station's logo on a dark well. rpm's own copy first, then what the station publishes, then the antenna. A
  // station with no logo and one whose link is dead look the same, and neither is a failure.
  import { radioRules } from '../../app';
  import { icons } from '../../design/icons';
  import { logosOf } from '../../radio/logo';
  import type { RadioStation } from '../../radio/station';

  let { station, size = 51 }: { station: RadioStation; size?: number } = $props();

  const tries = $derived([radioRules.logoAddress(station.uuid), ...logosOf(station.favicon, station.otherLogos)]);
  let at = $state(0);

  $effect(() => {
    void station.uuid;
    at = 0;
  });
</script>

<span class="well" style:width="{size}px" style:height="{size}px">
  {#if tries[at]}
    <img src={tries[at]} alt="" loading="lazy" onerror={() => at++} />
  {:else}
    <i class="icon">{icons.broadcast}</i>
  {/if}
</span>

<style>
  .well {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 6px;
    background: rgb(0 0 0 / 0.13);
    color: rgb(255 255 255 / 0.27);
    font-size: 20px;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    padding: 3px;
    object-fit: contain;
  }
</style>
