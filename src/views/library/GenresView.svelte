<script lang="ts">
  // Genres: the shelves the collection fills, each in its own lettering and colour, and each one's page.
  import { articles, player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { VARIOUS_ARTISTS } from '../../library/artists';
  import { genreArtTable, photoAddress, type GenreArt } from '../../library/genre-art';
  import { shelvesOf, UNCLASSIFIED, type GenreWallItem } from '../../library/genres';
  import { albumsByKey, artistWall, genreWall } from '../../library/walls';
  import { library, room } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import ArticleBlock from './ArticleBlock.svelte';
  import GenreCard from './GenreCard.svelte';
  import GenreMark from './GenreMark.svelte';
  import ArtistTile from './ArtistTile.svelte';
  import Shelf from './Shelf.svelte';

  let { onOpen, onArtist }: { onOpen: (album: CloudAlbum) => void; onArtist: (name: string) => void } = $props();

  let openName = $state<string | null>(null);
  let table = $state.raw<Record<string, GenreArt>>({});

  void genreArtTable().then((loaded) => (table = loaded));

  const held = $derived(albumsByKey(library.albums));
  const wall = $derived(genreWall(library.albums));
  const open = $derived(openName === null ? null : (wall.find((genre) => genre.name === openName) ?? null));
  const page = $derived(open ? shelvesOf(open, held, artistWall(library.albums)) : null);

  const recordsOf = (keys: readonly string[]) => keys.flatMap((key) => held.get(key) ?? []);
  const shown = (name: string) => (name === UNCLASSIFIED ? text('Queue_ChipNotIdentified') : name);

  // Who stands for a shelf on its card: the act with the most records on it.
  function actOf(genre: GenreWallItem): string | null {
    const counts = new Map<string, number>();
    for (const album of recordsOf(genre.albums)) {
      if (album.artist !== VARIOUS_ARTISTS) counts.set(album.artist, (counts.get(album.artist) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  const openArt = $derived(open ? table[open.name] : undefined);
  const openPhoto = $derived(openArt ? photoAddress(openArt) : null);

  // The room takes the shelf's own colour while its page is open.
  $effect(() => {
    room.colour = open ? (openArt?.colour ?? null) : null;
    return () => {
      room.colour = null;
    };
  });
</script>

{#if open && page}
  <div class="page detail" style:--colour={openArt?.colour ?? '#30343c'}>
    <header class="head" style:background-image={openPhoto ? `url(${openPhoto})` : null}>
      <span class="across"></span>
      <button class="back-key back" title={text('Genres_Title')} aria-label={text('Genres_Title')} onclick={() => (openName = null)}><i class="icon">{icons.backArrow}</i></button>
      <div class="title">
        <span class="mark" style:aspect-ratio={openArt?.aspect ?? 'auto'}><GenreMark art={openArt} name={shown(open.name)} /></span>
        <p>{text('Genres_InLibrary', open.albums.length, page.acts.length)}</p>
      </div>
      <button class="deck-pill play" onclick={() => player.play(recordsOf(open.albums).flatMap((album) => album.tracks), 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i>{text('Genres_PopularPlayAll')}</button>
    </header>

    <div class="columns">
    <aside>
      {#key open.name}
        <ArticleBlock heading={text('Genres_About')} load={() => articles.ofGenre(open.name)} failed={text('Genres_AboutUnavailable')} />
      {/key}
    </aside>

    <div class="shelves">
      {#if page.added.length}<Shelf big title={text('Genres_RecentlyAdded', shown(open.name))} albums={recordsOf(page.added)} {onOpen} />{/if}

      {#if page.acts.length}
        <section>
          <h3 class="shelf-title">{text('Genres_NotableArtists', shown(open.name))}</h3>
          <div class="acts">
            {#each page.acts as act (act.name)}
              <ArtistTile name={act.name} album={recordsOf(act.albums)[0]} onOpen={() => onArtist(act.name)} />
            {/each}
          </div>
        </section>
      {/if}

      {#each page.eras as era (era.decade)}
        <Shelf big title={text('Genres_Decade', era.decade)} albums={recordsOf(era.albums)} {onOpen} />
      {/each}
      {#if !page.added.length && !page.eras.length}<Shelf big title={text('RightNav_Albums')} albums={recordsOf(open.albums)} {onOpen} />{/if}
    </div>
    </div>
  </div>
{:else}
  <div class="page">
    <header class="wall-head">
      <h2 class="heading">{text('Genres_Title')}</h2>
      <p class="pane-line">{wall.length === 1 ? text('Genres_CountOne') : text('Genres_Count', wall.length)}</p>
    </header>
    {#if wall.length}
      <div class="wall">
        {#each wall as genre (genre.name)}
          <GenreCard name={shown(genre.name)} act={actOf(genre)} albums={genre.albums.length} art={table[genre.name]} onOpen={() => (openName = genre.name)} />
        {/each}
      </div>
    {:else if library.state === 'ready'}
      <p class="empty">{text('Genres_Empty')}</p>
    {/if}
  </div>
{/if}

<style>
  .page {
    box-sizing: border-box;
    height: 100%;
    padding: 12px 18px 18px 16px;
    overflow-y: auto;
  }

  .empty {
    margin: 8px 0 0;
    color: rgb(255 255 255 / 0.6);
    font-size: 11.5px;
  }

  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 14px;
  }

  .page.detail {
    padding: 0;
    background: linear-gradient(color-mix(in srgb, var(--colour) 28%, transparent), transparent 60%);
  }

  .head {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: center;
    height: 142px;
    padding: 0 18px;
    border-bottom: 1px solid rgb(255 255 255 / 0.12);
    background-color: var(--colour);
    background-position: center;
    background-size: cover;
  }

  .across {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, var(--colour) 22%, color-mix(in srgb, var(--colour) 55%, transparent) 55%, transparent 90%);
  }

  .back,
  .title,
  .play {
    position: relative;
  }

  .title {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .mark {
    display: block;
    align-self: flex-start;
    height: 46px;
    max-width: 100%;
  }

  .title p {
    margin: 0;
    color: rgb(255 255 255 / 0.85);
    font-size: 12px;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
    gap: 4px;
    padding-top: 16px;
  }

  .shelves {
    min-width: 0;
    padding: 0 18px 18px;
  }

  @media (max-width: 1100px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  section {
    margin-bottom: 26px;
  }

  .acts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
  }
</style>
