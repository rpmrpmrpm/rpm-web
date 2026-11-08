<script lang="ts">
  // A record: its name with a few small keys, and its tracklist by disc, as the desktop's album band. Everything else
  // a record can do is on its menu, behind the last key or a right click. The drawer on the wall and the page on a
  // phone both show this.
  import { covers, favorites, player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import AlbumTracks from './AlbumTracks.svelte';
  import { albumMenu, menuAt } from './record-menu.svelte';
  import Stars from './Stars.svelte';

  let { album, columns = 2, rating = false, place = 'page', onSleeve }: { album: CloudAlbum; columns?: number; rating?: boolean; place?: 'collection' | 'page'; onSleeve?: (url: string) => void } = $props();

  let sleeve = $state<string | null>(null);

  // A record that is opened is a record about to be played.

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

  let loved = $state(false);

  $effect(() => {
    void library.marksVersion;
    const wanted = album;
    let current = true;
    void favorites.isAlbumMarked(wanted).then((marked) => {
      if (current) loved = marked;
    });
    return () => {
      current = false;
    };
  });

  // Who, when, and what the files are, as the band's line.
  const line = $derived.by(() => {
    const first = album.tracks[0];
    const extension = first?.relativePath?.split('.').pop()?.toUpperCase();
    const bits = first?.tags?.bitsPerSample;
    const rate = first?.tags?.sampleRate;
    const depth = bits && rate ? `${bits}/${(rate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : '';
    return [album.artist, album.year, extension, depth].filter(Boolean).join(' · ');
  });

  function shuffle() {
    player.play(album.tracks, 0, { inAlbumOrder: false });
    player.toggleShuffle();
  }
</script>

<div class="detail" use:menuOn={() => albumMenu(album, place)}>
  <div class="main">
    <header>
      <div class="name">
        <h3>{album.album}</h3>
        <span class="keys">
          <button class="mini-key" title={text('AlbumGrid_PlayAll')} aria-label={text('AlbumGrid_PlayAll')} onclick={() => player.play(album.tracks, 0)}><i class="icon">{icons.play}</i></button>
          <button class="mini-key" title={text('AlbumGrid_Shuffle')} aria-label={text('AlbumGrid_Shuffle')} onclick={shuffle}><i class="icon">{icons.shuffle}</i></button>
          <button class="mini-key" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menuAt(event, albumMenu(album, place))}><i class="icon">{icons.more}</i></button>
        </span>
      </div>
      <p>{line}</p>
      {#if rating}<Stars {album} />{/if}
    </header>

    <AlbumTracks {album} {columns} />
  </div>

  {#if columns > 1}
    <div class="art">
      {#if sleeve}<img src={sleeve} alt="" />{:else}<span class="blank"><i class="icon">{icons.album}</i></span>{/if}
      <div class="under">
        <button class="album-heart" class:on={loved} aria-pressed={loved} title={text('AlbumMenu_Favorite')} aria-label={text('AlbumMenu_Favorite')} onclick={() => favorites.markAlbum(album, !loved)}><i class="icon" class:outline={!loved}>{icons.heart}</i></button>
      </div>
    </div>
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

  .name {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  h3 {
    overflow: hidden;
    margin: 0;
    color: #fff;
    font-size: 17px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keys {
    display: flex;
    flex: none;
    gap: 12px;
  }

  p {
    margin: 4px 0 0;
    overflow: hidden;
    color: rgb(255 255 255 / 0.72);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .art {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 196px;
  }

  img,
  .blank {
    display: grid;
    place-items: center;
    width: 196px;
    height: 196px;
    border-radius: 8px;
    object-fit: cover;
    background: rgb(0 0 0 / 0.2);
    color: rgb(255 255 255 / 0.3);
    font-size: 40px;
  }

  .under {
    display: flex;
    justify-content: flex-end;
  }

  .album-heart {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--favorite-idle);
    font-size: 13px;
    cursor: pointer;
  }

  .album-heart.on {
    color: var(--favorite);
  }

  @media (max-width: 859px) {
    .art {
      display: none;
    }
  }
</style>
