<script lang="ts">
  // The band above the panes: the wordmark at rest, and the record with its seek bar while one plays.
  import type { CloudTrack } from '../../api/wire';
  import { catalogue, covers, player } from '../../app';
  import { displayOf, type RadioStation } from '../../radio/station';
  import { now, onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import SeekBar from '../deck/SeekBar.svelte';
  import StationLogo from '../radio/StationLogo.svelte';
  import { taglineParts } from './tagline';
  import Mark from './Mark.svelte';

  const tagline = taglineParts(text('Art_ParkedTagline'));

  let sleeve = $state<string | null>(null);

  // What stands on the band. It stays while the band closes, so the record leaves with it.
  let shown = $state.raw<CloudTrack | null>(null);
  let station = $state.raw<RadioStation | null>(null);
  let openHeight = $state(0);

  $effect(() => {
    if (now.track && !onAir.station) {
      shown = now.track;
      station = null;
    }
    if (onAir.station) {
      station = onAir.station;
      shown = null;
    }
  });

  $effect(() => {
    const track = now.track;
    if (!track) return;
    const album = catalogue.albums.find((a) => a.tracks.some((t) => t.rpmId === track.rpmId));
    if (!album) return;
    let current = true;
    void covers.url(album, 512).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<header class="band" class:open={onAir.station !== null || (now.track !== null && !now.stopped)} style:--open="{openHeight}px">
  <div class="rest">
    <Mark size={2} />
    <p class="tagline"><span class="head">{tagline.head}</span>{tagline.tail}</p>
  </div>

  <div class="playing" bind:clientHeight={openHeight}>
    {#if station}
      <Mark strength={0.25} />
      <div class="record">
        <StationLogo {station} size={132} />
        <div class="words">
          <h2>{displayOf(station)}</h2>
          <p class="artist">{station.country ?? ''}</p>
          <p class="album">{text(onAir.air === 'reconnecting' ? 'Radio_Reconnecting' : 'Radio_NoTrack')}</p>
        </div>
      </div>
    {:else if shown}
      <Mark strength={0.25} />
      <div class="record">
        {#if sleeve}<img src={sleeve} alt="" />{:else}<div class="sleeve"></div>{/if}
        <div class="words">
          <h2>{shown.title}</h2>
          <p class="artist">{shown.artist}</p>
          <p class="album">{shown.album}</p>
          <SeekBar seconds={now.seconds} duration={now.duration} onSeek={(s) => player.seek(s)} />
        </div>
      </div>
    {/if}
  </div>
</header>

<style>
  /* The measures of the desktop's parked mark. It sits 25 from the top and the left: the window's padding
     is 24, and the panes' surface starts inside their 1 px border. The band ends 94 down, less the gap. */
  .band {
    position: relative;
    height: 78px;
    overflow: hidden;
    transition: height 420ms var(--move);
  }

  .band.open {
    height: var(--open);
  }

  /* The drawer's clock: the band, the record and the wash in the room move together. */
  .rest,
  .playing {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    box-sizing: border-box;
    padding: 25px 0 0 1px;
    transition: opacity 420ms var(--move);
  }

  .rest {
    height: 78px;
  }

  .playing {
    opacity: 0;
  }

  .open .rest {
    opacity: 0;
  }

  .open .playing {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .band,
    .rest,
    .playing {
      transition: none;
    }
  }

  /* Stands on the stem of the p, 114 of the mark's 507 across, with the line just under its foot. The head
     hangs to the left, so the word starts before the letter and the d lands on the stem. */
  .tagline {
    position: relative;
    width: fit-content;
    margin: 1px 0 0 20.91px;
    color: rgb(255 255 255 / 0.65);
    font-size: 11px;
    line-height: 14px;
    white-space: nowrap;
  }

  .head {
    position: absolute;
    right: 100%;
    color: rgb(255 255 255 / 0.4);
  }

  .record {
    display: flex;
    gap: 16px;
    align-items: stretch;
    margin-top: 10px;
  }

  img,
  .sleeve {
    flex: none;
    width: 132px;
    height: 132px;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.08);
    object-fit: cover;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.4);
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: flex-end;
    min-width: 0;
  }

  h2 {
    overflow: hidden;
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 2px 0 0;
  }

  .artist {
    font-size: 15px;
    color: rgb(255 255 255 / 0.87);
  }

  .album {
    margin-bottom: 8px;
    font-size: 13px;
    color: rgb(255 255 255 / 0.6);
  }
</style>
