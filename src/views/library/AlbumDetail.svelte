<script lang="ts">
  // A record: its name, its keys, and its tracklist by disc. The drawer on the wall and the page on a
  // phone both show this.
  import { covers, player } from '../../app';
  import { durationSeconds, isExplicit, type CloudTrack } from '../../api/wire';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { discOf, trackOf } from '../../library/grouping';
  import { byDisc } from '../../library/tracklist';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { album, columns = 2, onSleeve }: { album: CloudAlbum; columns?: number; onSleeve?: (url: string) => void } = $props();

  let sleeve = $state<string | null>(null);

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, 512).then((url) => {
      if (!current) return;
      sleeve = url;
      if (url) onSleeve?.(url);
    });
    return () => {
      current = false;
    };
  });

  const discs = $derived(byDisc(album.tracks, discOf, trackOf));
  const seconds = $derived(album.tracks.reduce((sum, track) => sum + durationSeconds(track), 0));

  const time = (value: number) => {
    const total = Math.round(value);
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  const play = (track: CloudTrack) => player.play(album.tracks, album.tracks.indexOf(track));
</script>

<div class="detail">
  <div class="main">
    <header>
      <h3>{album.album}</h3>
      <p>
        {album.artist}{album.year ? ` • ${album.year}` : ''} • {text('Rpm_Album_Tracks', album.tracks.length)}
        {seconds ? ` • ${Math.round(seconds / 60)} min` : ''}
      </p>
      <div class="keys">
        <button class="glass-button primary" onclick={() => player.play(album.tracks, 0)}><i class="icon">{icons.play}</i> {text('AlbumMenu_Play')}</button>
        <button
          class="glass-button"
          onclick={() => {
            player.play(album.tracks, 0, { inAlbumOrder: false });
            player.toggleShuffle();
          }}><i class="icon">{icons.shuffle}</i> {text('AlbumMenu_Shuffle')}</button
        >
      </div>
    </header>

    <div class="tracks" style:column-count={columns}>
      {#each discs as disc}
        {#if discs.length > 1}
          <div class="disc">{text('Album_DiscHeader', disc.discNumber)}</div>
        {/if}
        {#each disc.tracks as track (track.rpmId)}
          <button class="track" class:playing={now.track?.rpmId === track.rpmId} onclick={() => play(track)}>
            <span class="number">{trackOf(track) || ''}</span>
            <span class="name">{track.title}{#if isExplicit(track)}<span class="badge">E</span>{/if}</span>
            <span class="length">{time(durationSeconds(track))}</span>
          </button>
        {/each}
      {/each}
    </div>
  </div>

  {#if columns > 1 && sleeve}
    <img src={sleeve} alt="" />
  {/if}
</div>

<style>
  .detail {
    display: flex;
    gap: 20px;
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  header {
    margin-bottom: 14px;
  }

  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }

  p {
    margin: 3px 0 0;
    color: var(--text-soft);
    font-size: 12.5px;
  }

  .keys {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .keys .icon {
    margin-right: 6px;
    font-size: 12px;
  }

  .tracks {
    column-gap: 18px;
  }

  .disc {
    margin: 10px 0 4px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--hairline);
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 700;
    break-after: avoid;
  }

  .track {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 8px;
    width: 100%;
    min-height: 26px;
    padding: 3px 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    text-align: left;
    cursor: pointer;
    break-inside: avoid;
  }

  @media (hover: hover) {
    .track:hover {
      background: rgb(255 255 255 / 0.1);
    }
  }

  @media (pointer: coarse) {
    .track {
      align-items: center;
      min-height: 44px;
    }
  }

  .track.playing .name {
    color: #5fe08a;
  }

  .number,
  .length {
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .name {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-grid;
    place-items: center;
    width: 13px;
    height: 13px;
    margin-left: 5px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.25);
    color: #000;
    font-size: 9px;
    font-weight: 700;
    vertical-align: 1px;
  }

  img {
    flex: none;
    align-self: flex-start;
    width: 210px;
    height: 210px;
    border-radius: 6px;
    object-fit: cover;
  }
</style>
