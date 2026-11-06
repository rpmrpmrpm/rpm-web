<script lang="ts">
  // The band above the panes: the wordmark at rest, and the record with its seek bar while one plays.
  import { catalogue, covers, player } from '../../app';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import SeekBar from '../deck/SeekBar.svelte';

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
    <span class="logo small">rpm</span>
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
    <span class="logo">rpm</span>
    <p>{text('Art_ParkedTagline')}</p>
  </header>
{/if}

<style>
  .rest {
    padding: 34px 0 12px;
  }

  .rest p {
    margin: 6px 0 0 8px;
    color: var(--text-soft);
    font-size: 13px;
  }

  .playing {
    padding: 14px 0 0;
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
