<script lang="ts">
  // A station's logo on a dark well. rpm's own copy first, then what the station publishes, then the antenna. A
  // station with no logo and one whose link is dead look the same, and neither is a failure.
  import { stationLogos } from '../../app';
  import { icons } from '../../design/icons';
  import { logosOf } from '../../radio/logo';
  import type { RadioStation } from '../../radio/station';
  import { seen } from '../library/seen';

  let { station, size = 51 }: { station: RadioStation; size?: number } = $props();

  // rpm's own logo: undefined until it has been read, null when rpm has none or it could not be read.
  let own = $state<string | null | undefined>(undefined);
  let near = $state(false);
  let at = $state(0);

  // Nothing is tried until rpm's own answer is in, so the station's own picture does not show first and then change.
  const tries = $derived(own === undefined ? [] : [...(own ? [own] : []), ...logosOf(station.favicon, station.otherLogos)]);

  // The logo is read only when the well comes near the view. A list of stations must not ask for all of them.
  // Each run keeps its own flag, so an answer for a station this well no longer shows is dropped.
  $effect(() => {
    const uuid = station.uuid;
    const known = stationLogos.known(uuid);
    at = 0;
    own = known;
    if (known !== undefined || !near) return;

    let current = true;
    stationLogos.url(uuid).then(
      (address) => {
        if (current) own = address;
      },
      () => {
        if (current) own = null;
      },
    );
    return () => {
      current = false;
    };
  });
</script>

<span class="well" style:width="{size}px" style:height="{size}px" use:seen={() => (near = true)}>
  {#if tries[at]}
    <img src={tries[at]} alt="" onerror={() => at++} />
  {:else if own !== undefined}
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
