<script lang="ts">
  // An act's page, as the desktop has it: their photograph and what is known about them down the left, and
  // their records on the right, with the record pressed open under its row.
  import { articles, artistArt, player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { creditNames, ownAlbums, VARIOUS_ARTISTS, type ArtistWallItem } from '../../library/artists';
  import { albumsByKey } from '../../library/walls';
  import { library, room } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import AlbumDetail from './AlbumDetail.svelte';
  import ArticleBlock from './ArticleBlock.svelte';
  import Shelf from './Shelf.svelte';
  import TrackRows from './TrackRows.svelte';

  let { artist, onOpen, onBack }: { artist: ArtistWallItem; onOpen: (album: CloudAlbum) => void; onBack: () => void } = $props();

  let photos = $state.raw<string[]>([]);
  let at = $state(0);
  let logo = $state<string | null>(null);
  let opened = $state.raw<CloudAlbum | null>(null);

  $effect(() => {
    const name = artist.name;
    let current = true;
    photos = [];
    at = 0;
    logo = null;
    void artistArt.photos(name).then((found) => {
      if (current) photos = found.filter((address) => address !== null);
    });
    void artistArt.logo(name).then((address) => {
      if (current) logo = address;
    });
    return () => {
      current = false;
    };
  });

  const held = $derived(albumsByKey(library.albums));
  const recordsOf = (keys: readonly string[]) => keys.flatMap((key) => held.get(key) ?? []);

  const open = (album: CloudAlbum) => (opened = opened === album ? null : album);

  // The room takes the colour of their first record while the page is open.
  $effect(() => {
    room.album = recordsOf(artist.albums)[0] ?? null;
    return () => {
      room.album = null;
    };
  });

  let finding = $state('');
  const foundSongs = $derived.by(() => {
    const words = finding.trim().toLowerCase();
    return words ? songs.filter((track) => track.title?.toLowerCase().includes(words)) : songs;
  });

  // Their songs on the records they lead, and the ones naming them on anybody else's.
  const songs = $derived.by(() => {
    const compilation = artist.name === VARIOUS_ARTISTS;
    const own = recordsOf(ownAlbums(artist)).flatMap((album) => album.tracks);
    const guest = compilation ? [] : recordsOf(artist.appearances).flatMap((album) => album.tracks.filter((track) => creditNames(track.artist, artist.name)));
    return [...own, ...guest];
  });
</script>

<div class="page">
  <aside>
    <div class="photo">
      {#if photos[at]}<img src={photos[at]} alt="" />{/if}
      {#if logo}<img class="logo" src={logo} alt={artist.name} />{:else}<h2>{artist.name}</h2>{/if}
      <button class="back-key back" title={text('Artists_Back')} aria-label={text('Artists_Back')} onclick={onBack}><i class="icon">{icons.backArrow}</i></button>
      {#if photos.length > 1}
        <div class="steps">
          <button class="tool" aria-label={text('Home_FeatureBack')} onclick={() => (at = (at + photos.length - 1) % photos.length)}><i class="icon">{icons.back}</i></button>
          <button class="tool" aria-label={text('Home_FeatureOn')} onclick={() => (at = (at + 1) % photos.length)}><i class="icon">{icons.forward}</i></button>
        </div>
      {/if}
    </div>
    <button class="play-all" onclick={() => player.play(songs, 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i>{text('Home_PlayAllTracks')}</button>
    {#key artist.name}
      <ArticleBlock heading={text('TrackInfo_AboutArtist')} load={() => articles.ofArtist(artist.name)} />
    {/key}
  </aside>

  <div class="records">
    {#if artist.albums.length}
      <Shelf big title={text('Artists_Albums')} albums={recordsOf(artist.albums)} onOpen={open} />
    {/if}
    {#if opened}
      <div class="opened"><AlbumDetail album={opened} columns={2} /></div>
    {/if}
    {#if artist.together.length}<Shelf big title={text('Artists_Collaborations')} albums={recordsOf(artist.together)} onOpen={open} />{/if}
    {#if artist.appearances.length}<Shelf big title={text('Artists_AppearsOn')} albums={recordsOf(artist.appearances)} {onOpen} />{/if}
    <section>
      <div class="tracks-head">
        <h3 class="shelf-title">{text('Artists_AllTracks')}</h3>
        <label class="find"><i class="icon">{icons.search}</i><input type="search" placeholder={text('Artists_SearchTracks')} aria-label={text('Artists_SearchTracks')} bind:value={finding} /></label>
      </div>
      <TrackRows plain tracks={foundSongs} />
    </section>
  </div>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
    gap: 18px;
    height: 100%;
    box-sizing: border-box;
    padding: 0 18px 0 0;
  }

  aside {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
  }

  .photo {
    position: relative;
    flex: none;
    aspect-ratio: 1.34;
    overflow: hidden;
    background: rgb(255 255 255 / 0.05);
  }

  .photo > img:not(.logo) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .logo {
    position: absolute;
    bottom: 12px;
    left: 14px;
    max-width: 55%;
    max-height: 30%;
  }

  h2 {
    position: absolute;
    bottom: 12px;
    left: 14px;
    margin: 0;
    color: #fff;
    font-size: 28px;
    font-weight: 700;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.7);
  }

  .back {
    position: absolute;
    top: 22px;
    left: 24px;
  }

  .steps {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 6px;
  }

  .play-all {
    display: inline-flex;
    flex: none;
    gap: 7px;
    align-items: center;
    align-self: flex-start;
    height: 28px;
    margin-left: 14px;
    padding: 0 14px;
    border: 1px solid rgb(255 255 255 / 0.149);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.078);
    color: rgb(255 255 255 / 0.95);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .play-all .icon {
    font-size: 10px;
  }

  .tracks-head {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .find {
    display: flex;
    flex: 0 1 200px;
    gap: 8px;
    align-items: center;
    height: 28px;
    padding: 0 9px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  .find input {
    width: 100%;
    min-width: 0;
    border: 0;
    background: none;
    color: #fff;
    font-size: 16px;
    outline: none;
  }

  @media (pointer: fine) {
    .find input {
      font-size: 12px;
    }
  }

  .records {
    min-width: 0;
    padding: 16px 16px 18px 12px;
    overflow-y: auto;
  }

  .opened {
    margin-bottom: 26px;
    padding: 14px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.06);
  }

  @media (max-width: 899px) {
    .page {
      display: block;
      padding: 0;
      overflow-y: auto;
    }

    aside,
    .records {
      overflow: visible;
    }

    .records {
      padding: 14px 16px;
    }
  }
</style>
