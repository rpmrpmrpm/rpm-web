<script lang="ts">
  // Genres: the shelves the collection fills, and each one's page.
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { shelvesOf, UNCLASSIFIED } from '../../library/genres';
  import { albumsByKey, artistWall, genreWall } from '../../library/walls';
  import { library } from '../../state.svelte';
  import { albumCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import Shelf from './Shelf.svelte';
  import Sleeve from './Sleeve.svelte';

  let { onOpen }: { onOpen: (album: CloudAlbum) => void } = $props();

  let openName = $state<string | null>(null);

  const held = $derived(albumsByKey(library.albums));
  const wall = $derived(genreWall(library.albums));
  const open = $derived(openName === null ? null : (wall.find((genre) => genre.name === openName) ?? null));
  const page = $derived(open ? shelvesOf(open, held, artistWall(library.albums)) : null);

  const recordsOf = (keys: readonly string[]) => keys.flatMap((key) => held.get(key) ?? []);
  const shown = (name: string) => (name === UNCLASSIFIED ? text('Queue_ChipNotIdentified') : name);
</script>

{#if open && page}
  <div class="page">
    <button class="link" onclick={() => (openName = null)}><i class="icon">{icons.back}</i> {text('Genres_Title')}</button>
    <h2 class="heading">{shown(open.name)}</h2>
    <p>{text('Genres_InLibrary', open.albums.length, page.acts.length)}</p>
    <button class="glass-button primary" onclick={() => player.play(recordsOf(open.albums).flatMap((album) => album.tracks), 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i> {text('Genres_PopularPlayAll')}</button>
    {#if page.added.length}<Shelf title={text('Genres_RecentlyAdded', shown(open.name))} albums={recordsOf(page.added)} {onOpen} />{/if}
    {#each page.eras as era (era.decade)}
      <Shelf title={text('Genres_Decade', era.decade)} albums={recordsOf(era.albums)} {onOpen} />
    {/each}
    {#if !page.added.length && !page.eras.length}<Shelf title={text('RightNav_Albums')} albums={recordsOf(open.albums)} {onOpen} />{/if}
  </div>
{:else}
  <div class="page">
    <div>
      <h2 class="heading">{text('Genres_Title')}</h2>
      <p>{wall.length === 1 ? text('Genres_CountOne') : text('Genres_Count', wall.length)}</p>
    </div>
    <ul>
      {#each wall as genre (genre.name)}
        <li>
          <button onclick={() => (openName = genre.name)}>
            <Sleeve album={held.get(genre.albums[0] ?? '')} size={56} />
            <span class="words">
              <strong>{shown(genre.name)}</strong>
              <small>{albumCount(genre.albums.length)}</small>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    padding: 14px 16px;
    overflow-y: auto;
  }

  .page > .glass-button,
  .page > .link {
    align-self: flex-start;
  }

  p {
    margin: 2px 0 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    gap: 12px;
    align-items: center;
    width: 100%;
    padding: 8px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: rgb(255 255 255 / 0.04);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 14px;
  }

  small {
    color: var(--text-soft);
    font-size: 11.5px;
  }
</style>
