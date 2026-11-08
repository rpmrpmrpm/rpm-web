<script lang="ts">
  // A record's songs by disc, as the desktop's album band draws them. The marks stay out of the way until the pointer
  // is on a row, and a row's menu holds what a song can do.
  import { player } from '../../app';
  import { durationSeconds, isExplicit, type CloudTrack } from '../../api/wire';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { discOf, trackOf } from '../../library/grouping';
  import { byDisc } from '../../library/tracklist';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import Heart from './Heart.svelte';
  import { menuAt, trackMenu } from './record-menu.svelte';
  import PlayingBars from './PlayingBars.svelte';

  let { album, columns = 2 }: { album: CloudAlbum; columns?: number } = $props();

  const discs = $derived(byDisc(album.tracks, discOf, trackOf));

  const time = (value: number) => {
    const total = Math.round(value);
    return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
  };

  const play = (track: CloudTrack) => player.play(album.tracks, album.tracks.indexOf(track));
  const menuOfTrack = (track: CloudTrack) => trackMenu(track, album.tracks, album.tracks.indexOf(track));
</script>

<div class="tracks" style:column-count={columns}>
  {#each discs as disc}
    {#if discs.length > 1}
      <div class="disc">{text('Album_DiscHeader', disc.discNumber)}</div>
    {/if}
    {#each disc.tracks as track (track.rpmId)}
      <div class="track" use:menuOn={() => menuOfTrack(track)}>
        <button class="play" onclick={() => play(track)}>
          <span class="number">{trackOf(track) || ''}</span>
          <span class="title">{#if now.track?.rpmId === track.rpmId}<PlayingBars />{/if}{track.title}{#if isExplicit(track)}<span class="badge">E</span>{/if}</span>
          <span class="length">{time(durationSeconds(track))}</span>
        </button>
        <span class="marks">
          <Heart {track} />
          <button class="more" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menuAt(event, menuOfTrack(track))}><i class="icon">{icons.more}</i></button>
        </span>
      </div>
    {/each}
  {/each}
</div>

<style>
  .tracks {
    column-gap: 28px;
  }

  .disc {
    margin: 10px 0 4px;
    padding-bottom: 5px;
    border-bottom: 1px solid rgb(255 255 255 / 0.149);
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
    font-weight: 600;
    break-after: avoid;
  }

  .track {
    display: flex;
    align-items: center;
    height: 22px;
    border-radius: 4px;
    break-inside: avoid;
    -webkit-touch-callout: none;
  }

  .play {
    display: grid;
    flex: 1;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-width: 0;
    height: 100%;
    padding: 0 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .number {
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
    text-align: right;
  }

  .title {
    display: flex;
    gap: 6px;
    align-items: center;
    overflow: hidden;
    color: rgb(255 255 255 / 0.93);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .length {
    color: rgb(255 255 255 / 0.53);
    font-size: 12px;
  }

  .badge {
    flex: none;
    padding: 0 3px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.25);
    font-size: 9px;
    font-weight: 700;
  }

  .marks {
    display: flex;
    flex: none;
    align-items: center;
    width: 40px;
    padding-right: 4px;
  }

  .more {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .track {
      height: 40px;
    }

    .more {
      width: 28px;
      height: 28px;
    }

    .marks {
      width: 56px;
    }
  }

  @media (hover: hover) {
    .track:hover {
      background: rgb(255 255 255 / 0.094);
    }

    .track :global(.heart:not(.on)),
    .more {
      opacity: 0;
    }

    .track:hover :global(.heart),
    .track:hover .more,
    .more:focus-visible {
      opacity: 1;
    }

    .more:hover {
      background: rgb(255 255 255 / 0.133);
    }
  }
</style>
