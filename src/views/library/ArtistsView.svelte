<script lang="ts">
  // Artists: everyone the collection files a record under, and each one's page.
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { artistMatches, creditNames, initialOf, ownAlbums, searchKey, sortArtists, VARIOUS_ARTISTS, type ArtistOrdering, type ArtistWallItem } from '../../library/artists';
  import { albumsByKey, artistWall } from '../../library/walls';
  import { library } from '../../state.svelte';
  import { albumCount, trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import Shelf from './Shelf.svelte';
  import Sleeve from './Sleeve.svelte';
  import TrackRows from './TrackRows.svelte';

  let { onOpen }: { onOpen: (album: CloudAlbum) => void } = $props();

  const ORDERINGS: [ArtistOrdering, string][] = [
    ['Name', 'ArtistSort_Name'],
    ['Albums', 'ArtistSort_Albums'],
    ['Tracks', 'ArtistSort_Tracks'],
    ['Added', 'ArtistSort_Added'],
  ];

  let search = $state('');
  let ordering = $state<ArtistOrdering>('Name');
  let openName = $state<string | null>(null);

  const held = $derived(albumsByKey(library.albums));
  const sorted = $derived(sortArtists(artistWall(library.albums), ordering, held));
  const shown = $derived.by(() => {
    const wanted = searchKey(search);
    return wanted ? sorted.filter((artist) => artistMatches(artist.name, search)) : sorted;
  });
  const open = $derived(openName === null ? null : (artistWall(library.albums).find((artist) => artist.name === openName) ?? null));

  const recordsOf = (keys: readonly string[]) => keys.flatMap((key) => held.get(key) ?? []);
  const first = (artist: ArtistWallItem) => held.get(ownAlbums(artist)[0] ?? '');

  // Their songs on the records they lead, and the ones naming them on anybody else's.
  const songsOf = (artist: ArtistWallItem) => {
    const compilation = artist.name === VARIOUS_ARTISTS;
    const own = recordsOf(ownAlbums(artist)).flatMap((album) => album.tracks);
    const guest = compilation ? [] : recordsOf(artist.appearances).flatMap((album) => album.tracks.filter((track) => creditNames(track.artist, artist.name)));
    return [...own, ...guest];
  };
</script>

{#if open}
  <div class="page">
    <button class="link" onclick={() => (openName = null)}><i class="icon">{icons.back}</i> {text('Artists_Back')}</button>
    <h2 class="heading">{open.name}</h2>
    <button class="glass-button primary" onclick={() => player.play(songsOf(open), 0, { inAlbumOrder: false })}><i class="icon">{icons.play}</i> {text('Rpm_Artist_PlayAll')}</button>
    {#if open.albums.length}<Shelf title={text('Artists_Albums')} albums={recordsOf(open.albums)} {onOpen} />{/if}
    {#if open.together.length}<Shelf title={text('Artists_Collaborations')} albums={recordsOf(open.together)} {onOpen} />{/if}
    {#if open.appearances.length}<Shelf title={text('Artists_AppearsOn')} albums={recordsOf(open.appearances)} {onOpen} />{/if}
    <section>
      <h3>{text('Artists_AllTracks')}</h3>
      <TrackRows tracks={songsOf(open)} />
    </section>
  </div>
{:else}
  <div class="page">
    <header>
      <div>
        <h2 class="heading">{text('Artists_Title')}</h2>
        <p>{shown.length === 1 ? text('Artists_CountOne') : text('Artists_Count', shown.length)}</p>
      </div>
      <div class="tools">
        <input class="field" type="search" placeholder={text('Artists_SearchPlaceholder')} bind:value={search} />
        <select class="field" aria-label={text('AlbumSort_Tooltip')} bind:value={ordering}>
          {#each ORDERINGS as [value, key]}<option {value}>{text(key)}</option>{/each}
        </select>
      </div>
    </header>

    {#if shown.length}
      <ul>
        {#each shown as artist, index (artist.name)}
          {#if ordering === 'Name' && (index === 0 || initialOf(shown[index - 1]!.name) !== initialOf(artist.name))}
            <li class="letter">{initialOf(artist.name)}</li>
          {/if}
          <li>
            <button onclick={() => (openName = artist.name)}>
              <Sleeve album={first(artist)} />
              <span class="words">
                <strong>{artist.name}</strong>
                <small>{albumCount(ownAlbums(artist).length)}  •  {trackCount(artist.tracks)}</small>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if library.state === 'ready'}
      <p class="soft">{text('Artists_NoMatch')}</p>
    {/if}
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
    align-items: stretch;
  }

  .page > .glass-button,
  .page > .link {
    align-self: flex-start;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    justify-content: space-between;
  }

  header p,
  .soft {
    margin: 2px 0 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  .tools {
    display: flex;
    gap: 10px;
  }

  .tools .field {
    height: 30px;
    font-size: 12px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 2px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .letter {
    grid-column: 1 / -1;
    padding: 8px 6px 2px;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 700;
  }

  li button {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-soft);
    font-size: 11.5px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  @media (hover: hover) {
    li button:hover {
      background: rgb(255 255 255 / 0.07);
    }
  }
</style>
