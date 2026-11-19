<script lang="ts" module>
  export type { LibraryMode } from './pages.svelte';
</script>

<script lang="ts">
  // The right pane: which view of the collection is showing, and a record opened from it.
  import type { CloudAlbum } from '../../library/albums';
  import { text } from '../../strings/loc';
  import AlbumSheet from './AlbumSheet.svelte';
  import ArtistsView from './ArtistsView.svelte';
  import Collection from './Collection.svelte';
  import GenresView from './GenresView.svelte';
  import HomeView from './HomeView.svelte';
  import PlaylistsView from './PlaylistsView.svelte';
  import { pages, toWall, type LibraryMode } from './pages.svelte';
  import { asked } from './record-menu.svelte';

  let {
    mode,
    compact = false,
    picker = false,
    onPick = () => {},
    onImport,
  }: { mode: LibraryMode; compact?: boolean; picker?: boolean; onPick?: (mode: LibraryMode) => void; onImport: () => void } = $props();

  const PICKS: [LibraryMode, string][] = [
    ['albums', 'RightNav_Albums'],
    ['artists', 'RightNav_Artists'],
    ['genres', 'RightNav_Genres'],
    ['playlists', 'Playlists_Title'],
  ];

  const onOpen = (album: CloudAlbum) => (asked.opening = album);

  // Pressing an act on a genre page opens their page on the artist wall. This is not a press on the Artists key,
  // so the page is not closed on the way.
  function onArtist(name: string) {
    pages.artist = name;
    onPick('artists');
  }

  // A chip asks for its view, not for a page open in it.
  function picked(id: LibraryMode) {
    toWall(id);
    onPick(id);
  }
</script>

<div class="library">
  {#if picker}
    <div class="picks" role="tablist">
      {#each PICKS as [id, label]}
        <button class="chip" class:on={mode === id} role="tab" aria-selected={mode === id} onclick={() => picked(id)}>{text(label)}</button>
      {/each}
    </div>
  {/if}
  <div class="view">
    {#if asked.opening && !compact}
      <AlbumSheet album={asked.opening} onBack={() => (asked.opening = null)} />
    {:else if mode === 'home'}
      <HomeView {onOpen} {onImport} />
    {:else if mode === 'artists'}
      <ArtistsView {onOpen} />
    {:else if mode === 'genres'}
      <GenresView {onOpen} {onArtist} />
    {:else if mode === 'playlists'}
      <PlaylistsView />
    {:else}
      <Collection {compact} {onImport} {onOpen} />
    {/if}
  </div>
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .picks {
    display: flex;
    flex: none;
    gap: 6px;
    padding: 2px 16px 6px;
    overflow-x: auto;
  }

  .chip {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: none;
    color: var(--text-soft);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .chip.on {
    background: rgb(255 255 255 / 0.15);
    color: var(--text);
  }

  .view {
    flex: 1;
    min-height: 0;
  }
</style>
