<script lang="ts">
  // A list of songs from anywhere: an artist, a playlist, a search.
  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Heart from './Heart.svelte';

  let { tracks, onRemove }: { tracks: CloudTrack[]; onRemove?: (track: CloudTrack, index: number) => void } = $props();

  const time = (track: CloudTrack) => {
    const total = Math.round(durationSeconds(track));
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };
</script>

<ol>
  {#each tracks as track, index (`${track.rpmId}-${index}`)}
    <li class:playing={now.track?.rpmId === track.rpmId}>
      <button class="song" onclick={() => player.play(tracks, index, { inAlbumOrder: false })}>
        <span class="title">{track.title}</span>
        <span class="by">{track.artist ?? ''}{track.album ? `  •  ${track.album}` : ''}</span>
        <span class="length">{time(track)}</span>
      </button>
      <Heart {track} />
      {#if onRemove}
        <button class="bin" title={text('Playlists_Remove')} aria-label={text('Playlists_Remove')} onclick={() => onRemove(track, index)}><i class="icon">{icons.trash}</i></button>
      {/if}
    </li>
  {/each}
</ol>

<style>
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 4px;
  }

  li.playing .title {
    color: #5fe08a;
  }

  .song {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
    gap: 12px;
    min-width: 0;
    padding: 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .title,
  .by {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .by,
  .length {
    color: var(--text-soft);
    font-size: 12px;
  }

  .bin {
    flex: none;
    width: 30px;
    height: 30px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 11px;
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .song {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .by {
      grid-row: 2;
    }
  }

  @media (hover: hover) {
    li:hover {
      background: rgb(255 255 255 / 0.07);
    }
  }
</style>
