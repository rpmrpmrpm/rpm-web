<script lang="ts">
  // The band above the panes: the wordmark at rest, and the record with its seek bar while one plays.
  import type { CloudTrack } from '../../api/wire';
  import { catalogue, covers, player } from '../../app';
  import { displayOf, type RadioStation } from '../../radio/station';
  import { art, now, onAir, setParked } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import SeekBar from '../deck/SeekBar.svelte';
  import StationLogo from '../radio/StationLogo.svelte';
  import { taglineParts } from './tagline';
  import Mark from './Mark.svelte';

  const tagline = taglineParts(text('Art_ParkedTagline'));

  // The grip shows for a moment when the band first has something on it, then only under the pointer.
  const DEBUT_MS = 5000;
  const DRAG_PX = 24;

  const onStage = $derived(onAir.station !== null || (now.track !== null && !now.stopped));
  let debut = $state(false);
  let debuted = false;
  let pressedAt: number | null = null;
  let dragged = false;

  $effect(() => {
    if (!onStage || debuted) return;
    debuted = true;
    debut = true;
    setTimeout(() => (debut = false), DEBUT_MS);
  });

  function pressed(event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pressedAt = event.clientY;
    dragged = false;
  }

  // Up tucks the band away, and down brings it back.
  function released(event: PointerEvent) {
    if (pressedAt === null) return;
    const moved = event.clientY - pressedAt;
    pressedAt = null;
    if (Math.abs(moved) < DRAG_PX) return;
    dragged = true;
    setParked(moved < 0);
  }

  // A click brings a tucked band back, and on an open band a double click does the tucking.
  function clicked() {
    if (!dragged && art.parked) setParked(false);
  }

  function keyed(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setParked(!art.parked);
  }

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

<header class="band" class:open={onStage && !art.parked} style:--open="{openHeight}px">
  <div class="rest">
    <Mark size={2} />
    <p class="tagline"><span class="head">{tagline.head}</span>{tagline.tail}</p>
  </div>

  {#if onStage && art.parked}
    <div class="corner">
      {#if station}
        <strong>{displayOf(station)}</strong>
        <span class="artist">{station.country ?? ''}</span>
        <span class="album">{text(onAir.air === 'reconnecting' ? 'Radio_Reconnecting' : 'Radio_NoTrack')}</span>
      {:else if shown}
        <strong>{shown.title}</strong>
        <span class="artist">{shown.artist}</span>
        <span class="album">{shown.album}</span>
        <SeekBar bare seconds={now.seconds} duration={now.duration} onSeek={(s) => player.seek(s)} />
      {/if}
    </div>
  {/if}

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

  {#if onStage}
    <button
      class="grip"
      class:debut
      title={text('Coach_ArtHeader')}
      aria-label={text('Coach_ArtHeader')}
      aria-expanded={!art.parked}
      onpointerdown={pressed}
      onpointerup={released}
      onclick={clicked}
      ondblclick={() => !art.parked && setParked(true)}
      onkeydown={keyed}
    ><span></span></button>
  {/if}
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
  /* The strip along the foot of the band. The pill exists only under the pointer: always drawn, it would be a mark
     across the artwork for a gesture nobody is making. */
  .grip {
    position: absolute;
    z-index: 2;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    place-items: end center;
    height: 14px;
    padding: 0 0 2px;
    border: 0;
    background: none;
    cursor: ns-resize;
    touch-action: none;
  }

  .grip span {
    display: block;
    width: 54px;
    height: 7px;
    border: 1px solid rgb(255 255 255 / 0.25);
    border-radius: 3.5px;
    background: rgb(255 255 255 / 0.1);
    opacity: 0;
    backdrop-filter: blur(16px);
  }

  .grip.debut span,
  .grip:focus-visible span {
    opacity: 1;
  }

  @media (hover: hover) {
    .grip:hover span {
      border-color: rgb(255 255 255 / 0.9);
      opacity: 1;
    }
  }

  /* The small player: right-aligned, at the end of the strip, with the words and the line ending together. */
  .corner {
    position: absolute;
    top: 16px;
    right: 0;
    display: flex;
    flex-direction: column;
    width: min(345px, 50%);
    text-align: right;
  }

  .corner strong,
  .corner span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .corner strong {
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    line-height: 20px;
  }

  .corner .artist {
    color: rgb(255 255 255 / 0.8);
    font-size: 11px;
    line-height: 14px;
  }

  .corner .album {
    margin-bottom: -4px;
    color: rgb(255 255 255 / 0.54);
    font-size: 10px;
    line-height: 13px;
  }

  /* DesktopOffer.svelte stands on this line at the right, change both. */
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
