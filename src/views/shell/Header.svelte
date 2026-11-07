<script lang="ts">
  // The band above the panes: the wordmark at rest, and the record with its seek bar while one plays.
  import { catalogue, covers, player } from '../../app';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import SeekBar from '../deck/SeekBar.svelte';
  import { taglineParts } from './tagline';
  import Mark from './Mark.svelte';

  const tagline = taglineParts(text('Art_ParkedTagline'));

  let sleeve = $state<string | null>(null);

  $effect(() => {
    const track = now.track;
    sleeve = null;
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

{#if now.track}
  <header class="playing">
    <Mark strength={0.25} />
    <div class="record">
      {#if sleeve}<img src={sleeve} alt="" />{:else}<div class="sleeve"></div>{/if}
      <div class="words">
        <h2>{now.track.title}</h2>
        <p class="artist">{now.track.artist}</p>
        <p class="album">{now.track.album}</p>
        <SeekBar seconds={now.seconds} duration={now.duration} onSeek={(s) => player.seek(s)} />
      </div>
    </div>
  </header>
{:else}
  <header class="rest">
    <Mark size={2} />
    <p class="tagline"><span class="head">{tagline.head}</span>{tagline.tail}</p>
  </header>
{/if}

<style>
  /* The measures of the desktop's parked mark. It sits 25 from the top and the left: the window's padding
     is 24, and the panes' surface starts inside their 1 px border. The band ends 94 down, less the gap. */
  header {
    padding: 25px 0 0 1px;
  }

  .rest {
    box-sizing: border-box;
    height: 78px;
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
    font-size: 24px;
    font-weight: 700;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  p {
    margin: 2px 0 0;
  }

  .artist {
    font-size: 16px;
    color: var(--text-soft);
  }

  .album {
    margin-bottom: 8px;
    font-size: 14px;
    color: var(--text-soft);
  }
</style>
