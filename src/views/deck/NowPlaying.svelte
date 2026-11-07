<script lang="ts">
  // The player on a phone, over everything else.
  import { catalogue, covers, lyrics, player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Heart from '../library/Heart.svelte';
  import LyricView from '../library/LyricView.svelte';
  import TrackInfo from '../library/TrackInfo.svelte';
  import { EMPTY_SHEET, isSynced, type LyricSheet } from '../../lyrics/sheet';
  import Equalizer from './Equalizer.svelte';
  import SeekBar from './SeekBar.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let sleeve = $state<string | null>(null);

  $effect(() => {
    const track = now.track;
    if (!track) return;
    const album = catalogue.albums.find((a) => a.tracks.some((t) => t.rpmId === track.rpmId));
    if (!album) return;
    let current = true;
    void covers.url(album, 1024).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });

  let equalizerOpen = $state(false);
  let sheet = $state.raw<LyricSheet>(EMPTY_SHEET);
  let wordsOpen = $state(false);
  let infoOpen = $state(false);
  const hasWords = $derived(isSynced(sheet));

  // The key needs to know whether there are words before it is pressed, so the screen asks as it appears.
  $effect(() => {
    const track = now.track;
    sheet = EMPTY_SHEET;
    if (!track) return;
    let current = true;
    void lyrics.of(track).then((found) => {
      if (current) sheet = found;
    });
    return () => {
      current = false;
    };
  });
</script>

<section class="player">
  <button class="key close" title={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.chevronDown}</i></button>

  {#if infoOpen}
    <div class="info"><TrackInfo compact /></div>
  {:else if wordsOpen && hasWords && now.track}
    <LyricView track={now.track} {sheet} />
  {:else if sleeve}<img src={sleeve} alt="" />{:else}<div class="sleeve"></div>{/if}

  <div class="words">
    <h2>{now.track?.title}</h2>
    <p>{now.track?.artist}</p>
    {#if now.track}<Heart track={now.track} />{/if}
  </div>

  <SeekBar seconds={now.seconds} duration={now.duration} onSeek={(s) => player.seek(s)} />

  {#if equalizerOpen}
    <Equalizer />
  {/if}

  <div class="keys">
    <button class="key" title={text('Transport_Shuffle')} class:on={now.shuffled} onclick={() => player.toggleShuffle()}><i class="icon">{icons.shuffle}</i></button>
    <button class="key" title={text('Transport_Previous')} onclick={() => player.previous()}><i class="icon wide">{icons.previous}</i></button>
    <button class="key play" title={text('Transport_PlayPause')} onclick={() => player.toggle()}><i class="icon">{now.wantsToPlay ? icons.pause : icons.play}</i></button>
    <button class="key" title={text('Transport_Next')} onclick={() => player.next()}><i class="icon wide">{icons.next}</i></button>
    <button class="key" title={text('Transport_Repeat')} class:on={now.repeat !== 'off'} onclick={() => player.cycleRepeat()}><i class="icon">{icons.repeat}</i></button>
  </div>
  <div class="extras">
    <button class="key" title={text('Details_Lyrics')} aria-label={text('Details_Lyrics')} aria-pressed={wordsOpen} class:on={wordsOpen} disabled={!hasWords} onclick={() => { wordsOpen = !wordsOpen; infoOpen = false; }}><i class="icon">{icons.microphone}</i></button>
    <button class="tool sound" class:on={equalizerOpen} onclick={() => (equalizerOpen = !equalizerOpen)}>{text('Amp_Eq')}</button>
    <button class="key" title={text('LeftNav_TrackInfo')} aria-label={text('LeftNav_TrackInfo')} aria-pressed={infoOpen} class:on={infoOpen} onclick={() => (infoOpen = !infoOpen)}><i class="icon">{icons.info}</i></button>
  </div>
</section>

<style>
  .player {
    position: fixed;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: max(12px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
    background: rgb(8 10 16 / 0.92);
    backdrop-filter: blur(40px);
  }

  .close {
    align-self: flex-start;
    margin-left: -12px;
  }

  img,
  .sleeve {
    width: 100%;
    max-height: 50dvh;
    aspect-ratio: 1;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.08);
    object-fit: cover;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-soft);
  }

  .keys {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .wide {
    font-size: 22px;
  }

  .play .icon {
    font-size: 40px;
    color: #fff;
  }

  .on {
    color: #04c8ff;
  }

  .extras {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .extras .key:disabled {
    opacity: 0.4;
  }

  .info {
    flex: 1;
    min-height: 0;
    margin: 0 -24px;
  }
</style>
