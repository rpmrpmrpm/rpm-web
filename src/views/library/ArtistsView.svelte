<script lang="ts">
  // Artists: everyone the collection files a record under, and each one's page.
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { artistMatches, initialOf, ownAlbums, searchKey, sortArtists, type ArtistWallItem } from '../../library/artists';
  import { albumsByKey, artistWall } from '../../library/walls';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import AlphabetRail from './AlphabetRail.svelte';
  import ArtistPage from './ArtistPage.svelte';
  import ArtistTile from './ArtistTile.svelte';
  import { pages } from './pages.svelte';

  let { onOpen }: { onOpen: (album: CloudAlbum) => void } = $props();

  let search = $state('');
  let scroller = $state<HTMLElement | null>(null);
  let lit = $state('');

  const held = $derived(albumsByKey(library.albums));
  const every = $derived(artistWall(library.albums));
  const sorted = $derived(sortArtists(every, 'Name', held));
  const shown = $derived.by(() => {
    const wanted = searchKey(search);
    return wanted ? sorted.filter((artist) => artistMatches(artist.name, search)) : sorted;
  });
  const open = $derived(pages.artist === null ? null : (every.find((artist) => artist.name === pages.artist) ?? null));
  const first = (artist: ArtistWallItem) => held.get(ownAlbums(artist)[0] ?? '');

  const letterOf = (name: string) => {
    const letter = initialOf(name).toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : '#';
  };
  const letters = $derived(new Set(shown.map((artist) => letterOf(artist.name))));

  function jump(letter: string) {
    const target = shown.find((artist) => letterOf(artist.name) === letter);
    if (!target || !scroller) return;
    lit = letter;
    scroller.querySelector(`[data-artist="${CSS.escape(target.name)}"]`)?.scrollIntoView({ block: 'start' });
  }

  // The rail lights the letter the wall has reached.
  function followScroll() {
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top;
    const tile = [...scroller.querySelectorAll<HTMLElement>('[data-artist]')].find((element) => element.getBoundingClientRect().bottom > top);
    if (tile) lit = letterOf(tile.dataset.artist!);
  }

  const onCloseArtist = () => (pages.artist = null);
</script>

{#if open}
  <ArtistPage artist={open} {onOpen} onBack={onCloseArtist} />
{:else}
  <div class="wall-page">
    <header>
      <div>
        <h2 class="heading">{text('Artists_Title')}</h2>
        <p class="pane-line">{shown.length === 1 ? text('Artists_CountOne') : text('Artists_Count', shown.length)}</p>
      </div>
      <label class="search">
        <i class="icon">{icons.search}</i>
        <input type="search" placeholder={text('Artists_SearchPlaceholder')} bind:value={search} />
      </label>
    </header>

    <div class="scroller" bind:this={scroller} onscroll={followScroll}>
      {#if shown.length}
        <div class="tiles">
          {#each shown as artist (artist.name)}
            <div data-artist={artist.name}>
              <ArtistTile name={artist.name} album={first(artist)} onOpen={() => (pages.artist = artist.name)} />
            </div>
          {/each}
        </div>
      {:else if library.state === 'ready'}
        <p class="empty">{text(library.albums.length ? 'Artists_NoMatch' : 'Artists_Empty')}</p>
      {/if}
    </div>
    <AlphabetRail {letters} lit={lit} onPick={jump} />
  </div>
{/if}

<style>
  .wall-page {
    position: relative;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100%;
    padding: 12px 0 0 16px;
  }

  header {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
    padding-right: 18px;
  }

  .search {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 180px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
    color: rgb(255 255 255 / 0.6);
  }

  .search .icon {
    font-size: 11px;
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    color: #fff;
    font: inherit;
    font-size: 12px;
  }

  .scroller {
    flex: 1;
    min-height: 0;
    padding: 2px 26px 20px 0;
    overflow-y: auto;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
    gap: 14px;
  }

  .empty {
    color: rgb(255 255 255 / 0.55);
    font-size: 13px;
    text-align: center;
  }
</style>
