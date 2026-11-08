<script lang="ts">
  // A list of songs from anywhere: an artist, a playlist, a search.
  import { durationSeconds, type CloudTrack } from '../../api/wire';
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { catalogue } from '../../app';
  import { menuOn, type MenuEntry } from '../menu/menu.svelte';
  import Heart from './Heart.svelte';
  import PlayingBars from './PlayingBars.svelte';
  import { menuAt, trackMenu } from './record-menu.svelte';

  // plain: every song is the same act's, so the row says only its name, and they stand in two columns.
  let { tracks, onRemove, plain = false }: { tracks: CloudTrack[]; onRemove?: (track: CloudTrack, index: number) => void; plain?: boolean } = $props();

  function menuOfTrack(track: CloudTrack, index: number): MenuEntry[] {
    const album = catalogue.albums.find((held) => held.tracks.some((row) => row.rpmId === track.rpmId));
    const entries = trackMenu(track, tracks, index, { inAlbumOrder: false, album });
    return onRemove ? [...entries, 'rule', { label: text('Playlists_Remove'), glyph: icons.minus, run: () => onRemove(track, index) }] : entries;
  }

  const time = (track: CloudTrack) => {
    const total = Math.round(durationSeconds(track));
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };
</script>

<ol class:plain>
  {#each tracks as track, index (`${track.rpmId}-${index}`)}
    <li use:menuOn={() => menuOfTrack(track, index)}>
      <button class="song" onclick={() => player.play(tracks, index, { inAlbumOrder: false })}>
        <span class="title">{#if now.track?.rpmId === track.rpmId}<PlayingBars />{/if}{track.title}</span>
        {#if !plain}<span class="by">{track.artist ?? ''}{track.album ? `  •  ${track.album}` : ''}</span>{/if}
        <span class="length">{time(track)}</span>
      </button>
      <Heart {track} />
      <button class="more" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menuAt(event, menuOfTrack(track, index))}><i class="icon">{icons.more}</i></button>
    </li>
  {/each}
</ol>

<style>
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  ol.plain {
    column-gap: 28px;
    column-count: 2;
  }

  .plain li {
    break-inside: avoid;
  }

  .plain .song {
    grid-template-columns: minmax(0, 1fr) auto;
    font-size: 12.5px;
  }

  @media (max-width: 899px) {
    ol.plain {
      column-count: 1;
    }
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 4px;
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

  .more {
    flex: none;
    width: 22px;
    height: 22px;
    margin-right: 2px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.6);
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

  /* Marks appear under the pointer. A phone has no pointer to bring them out. */
  @media (hover: hover) {
    li:hover {
      background: rgb(255 255 255 / 0.094);
    }

    li :global(.heart:not(.on)),
    .more {
      opacity: 0;
    }

    li:hover :global(.heart),
    li:hover .more,
    .more:focus-visible {
      opacity: 1;
    }
  }
</style>
