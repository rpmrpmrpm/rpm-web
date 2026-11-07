<script lang="ts">
  // One record on the album list: the sleeve with what it adds up to, and its name and songs beside that.
  import { covers, favorites, player } from '../../app';
  import { durationSeconds } from '../../api/wire';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { colourOf } from '../../library/colour';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import AlbumTracks from './AlbumTracks.svelte';
  import { albumMenu, asked, menuAt } from './record-menu.svelte';

  let { album }: { album: CloudAlbum } = $props();

  let sleeve = $state<string | null>(null);
  let ring = $state('transparent');
  let loved = $state(false);

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, 512).then(async (url) => {
      if (!current || !url) return;
      sleeve = url;
      const colour = await colourOf(url);
      if (current && colour) ring = `rgb(${colour.r} ${colour.g} ${colour.b})`;
    });
    return () => {
      current = false;
    };
  });

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

  const seconds = $derived(album.tracks.reduce((sum, track) => sum + durationSeconds(track), 0));
  const summary = $derived(text(album.tracks.length === 1 ? 'Library_SongsAndTimeOne' : 'Library_SongsAndTime', album.tracks.length, Math.round(seconds / 60)));

  // The genre is a fact about the record only when its songs agree on it.
  const genre = $derived.by(() => {
    const genres = new Set(album.tracks.map((track) => track.tags?.genre).filter(Boolean));
    return genres.size === 1 ? [...genres][0] : '';
  });
  const line = $derived([album.artist, genre, album.year].filter(Boolean).join('  •  '));

  function shuffle() {
    player.play(album.tracks, 0, { inAlbumOrder: false });
    player.toggleShuffle();
  }
</script>

<article use:menuOn={() => albumMenu(album, 'collection')}>
  <div class="art">
    <span class="square">
      {#if sleeve}<img src={sleeve} alt="" loading="lazy" />{:else}<i class="icon">{icons.album}</i>{/if}
      <button class="open" title={text('AlbumMenu_AlbumPage')} aria-label={text('AlbumMenu_AlbumPage')} onclick={() => (asked.opening = album)}><i class="icon">{icons.album}</i></button>
    </span>
    <span class="ring" style:background={ring}></span>
    <div class="under">
      <span class="summary">{summary}</span>
      <button class="heart" class:on={loved} aria-pressed={loved} title={text('AlbumMenu_Favorite')} aria-label={text('AlbumMenu_Favorite')} onclick={() => favorites.markAlbum(album, !loved)}><i class="icon" class:outline={!loved}>{icons.heart}</i></button>
    </div>
  </div>

  <div class="main">
    <header>
      <h3>{album.album}</h3>
      <button class="mini-key" title={text('AlbumGrid_PlayAll')} aria-label={text('AlbumGrid_PlayAll')} onclick={() => player.play(album.tracks, 0)}><i class="icon">{icons.play}</i></button>
      <button class="mini-key" title={text('AlbumGrid_Shuffle')} aria-label={text('AlbumGrid_Shuffle')} onclick={shuffle}><i class="icon">{icons.shuffle}</i></button>
      <button class="mini-key" title={text('Common_MoreOptions')} aria-label={text('Common_MoreOptions')} onclick={(event) => menuAt(event, albumMenu(album, 'collection'))}><i class="icon">{icons.more}</i></button>
    </header>
    <p>{line}</p>
    <AlbumTracks {album} />
  </div>
</article>

<style>
  article {
    display: flex;
    gap: 24px;
    height: 100%;
    padding-bottom: 24px;
    border-bottom: 1px solid rgb(255 255 255 / 0.094);
  }

  .art {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 10px;
    width: 188px;
  }

  .square {
    position: relative;
    display: grid;
    place-items: center;
    width: 188px;
    height: 188px;
    background: rgb(0 0 0 / 0.133);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.133);
    color: rgb(255 255 255 / 0.3);
    font-size: 38px;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.133);
  }

  .open {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 40px;
    height: 32px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 7px;
    background: rgb(0 0 0 / 0.35);
    color: rgb(255 255 255 / 0.87);
    font-size: 14px;
    opacity: 0;
    cursor: pointer;
  }

  .square:hover .open,
  .open:focus-visible {
    opacity: 1;
  }

  .ring {
    display: block;
    flex: none;
    height: 2px;
  }

  .under {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .summary {
    flex: 1;
    overflow: hidden;
    color: rgb(255 255 255 / 0.53);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heart {
    flex: none;
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

  .heart.on {
    color: var(--favorite);
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  header {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  h3 {
    overflow: hidden;
    max-width: 460px;
    margin: 0;
    color: #fff;
    font-size: 16px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header :global(.mini-key) {
    font-size: 12px;
  }

  p {
    margin: 3px 0 12px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
    white-space: pre;
  }
</style>
