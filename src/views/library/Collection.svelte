<script lang="ts">
  // The library pane: its heading, its keys, and the wall.
  import { catalogue, favorites } from '../../app';
  import { icons } from '../../design/icons';
  import type { AlbumOrdering, CloudAlbum } from '../../library/albums';
  import { openMenu, type MenuEntry } from '../menu/menu.svelte';
  import { library } from '../../state.svelte';
  import { albumCount, trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import { searchSongs } from '../../library/search';
  import AlbumList, { type AlbumGrouping } from './AlbumList.svelte';
  import AlbumWall from './AlbumWall.svelte';
  import TrackTable from './TrackTable.svelte';
  import RecordSpinner from './RecordSpinner.svelte';
  import { collection, pickView, type CollectionView } from './view.svelte';

  let { compact = false, onImport, onOpen }: { compact?: boolean; onImport: () => void; onOpen: (album: CloudAlbum) => void } = $props();

  type View = CollectionView;

  let search = $state('');
  let target = $state(166);
  const view = $derived(collection.view);

  const VIEWS: [View, string, string][] = [
    ['grid', icons.grid, 'Library_ViewGrid'],
    ['list', icons.list, 'Library_ViewAlbums'],
    ['table', icons.table, 'Library_ViewTable'],
  ];

  const allTracks = $derived(library.albums.flatMap((album) => album.tracks));
  const hits = $derived(search.trim() ? searchSongs(library.albums, search).map((hit) => hit.track) : allTracks);

  const ORDERINGS: [AlbumOrdering, string, string][] = [
    ['Artist', 'AlbumSort_Artist', icons.artist],
    ['Album', 'AlbumSort_Album', icons.album],
    ['Added', 'AlbumSort_Added', icons.calendarAdded],
    ['Year', 'AlbumSort_Year', icons.calendar],
    ['Plays', 'AlbumSort_Plays', icons.headphones],
  ];

  const GROUPINGS: [AlbumGrouping, string, string][] = [
    ['None', 'AlbumGroup_None', icons.none],
    ['Artist', 'AlbumGroup_Artist', icons.artist],
    ['Genre', 'AlbumGroup_Genre', icons.genre],
    ['Year', 'AlbumGroup_Year', icons.calendar],
  ];

  const GROUP_KEY = 'rpm-library-group';

  function storedGroup(): AlbumGrouping {
    try {
      const stored = localStorage.getItem(GROUP_KEY);
      return stored === 'Artist' || stored === 'Genre' || stored === 'Year' ? stored : 'None';
    } catch {
      return 'None';
    }
  }

  let grouping = $state<AlbumGrouping>(storedGroup());
  let ordering = $state<AlbumOrdering>(catalogue.ordering);

  function pickGroup(next: AlbumGrouping) {
    grouping = next;
    try {
      localStorage.setItem(GROUP_KEY, next);
    } catch {
      // It holds for this visit.
    }
  }

  function pickOrdering(next: AlbumOrdering) {
    ordering = next;
    catalogue.setOrdering(next);
  }

  // A choice made rarely: a menu on one key, with a tick on the one in force.
  function choices(event: MouseEvent, entries: MenuEntry[]) {
    const key = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(entries, key.right - 175, key.bottom + 4);
  }

  const sortChoices = (): MenuEntry[] => ORDERINGS.map(([id, label, glyph]) => ({ label: text(label), glyph, ticked: ordering === id, run: () => pickOrdering(id) }));
  const groupChoices = (): MenuEntry[] => GROUPINGS.map(([id, label, glyph]) => ({ label: text(label), glyph, ticked: grouping === id, run: () => pickGroup(id) }));

  const stats = $derived.by(() => {
    const hours = Math.floor(library.seconds / 3600);
    const days = Math.floor(hours / 24);
    const time =
      days > 1
        ? text('Stats_DaysHours', days, hours % 24)
        : days === 1
          ? text('Stats_DaysHoursOne', hours % 24)
          : text('Stats_HoursMinutes', hours, Math.floor((library.seconds % 3600) / 60));
    return [albumCount(library.albums.length), trackCount(library.songs), time].join('  •  ');
  });

  let lovedOnly = $state(false);
  let loved = $state.raw<ReadonlySet<string>>(new Set());

  $effect(() => {
    void library.marksVersion;
    const albums = library.albums;
    if (!lovedOnly) return;
    let current = true;
    void favorites.albumsMarked(albums).then((marked) => {
      if (current) loved = marked;
    });
    return () => {
      current = false;
    };
  });

  const shown = $derived.by(() => {
    const words = search.trim().toLowerCase();
    const albums = lovedOnly ? library.albums.filter((album) => loved.has(album.key)) : library.albums;
    if (!words) return albums;
    return albums.filter(
      (album) =>
        album.album.toLowerCase().includes(words) ||
        album.artist.toLowerCase().includes(words) ||
        album.tracks.some((track) => track.title?.toLowerCase().includes(words)),
    );
  });
</script>

<div class="collection" class:compact>
  <header>
    <div class="titles">
      <h2 class="heading">{text('Library_Title')}</h2>
      <p class="pane-line">{library.state === 'ready' ? stats : ''}</p>
    </div>

    <div class="tools">
      <label class="search">
        <i class="icon">{icons.search}</i>
        <input type="search" placeholder={text('Review_SearchPlaceholder')} bind:value={search} />
      </label>
      <div class="slot">
        <button class="slot-key" class:lit={lovedOnly} aria-pressed={lovedOnly} title={text('Library_FavoritesOnly')} aria-label={text('Library_FavoritesOnly')} onclick={() => (lovedOnly = !lovedOnly)}><i class="icon" class:outline={!lovedOnly}>{icons.heart}</i></button>
      </div>
      {#if view === 'list'}
        <div class="slot">
          <button class="slot-key" title={text('AlbumGroup_Tooltip')} aria-label={text('AlbumGroup_Tooltip')} onclick={(event) => choices(event, groupChoices())}><i class="icon">{icons.group}</i></button>
        </div>
      {/if}
      <div class="slot views" role="group" aria-label={text('Library_ViewGrid')}>
        {#each VIEWS as [id, icon, label]}
          <button class="slot-key" class:on={view === id} title={text(label)} aria-label={text(label)} onclick={() => pickView(id)}><i class="icon">{icon}</i></button>
        {/each}
      </div>
      {#if view === 'grid'}
        <div class="slot">
          <button class="slot-key" title={text('AlbumSort_Tooltip')} aria-label={text('AlbumSort_Tooltip')} onclick={(event) => choices(event, sortChoices())}><i class="icon">{icons.sortDown}</i></button>
        </div>
        {#if !compact}
          <span class="size">
            <i class="small"></i>
            <input class="slim" style:--fill="{((target - 120) / 160) * 100}%" type="range" min="120" max="280" step="2" aria-label={text('AlbumGrid_CoverSize')} bind:value={target} />
            <i class="big"></i>
          </span>
        {/if}
      {/if}
    </div>
  </header>

  {#if library.stale}
    <div class="band" role="status">
      <span>{text('Rpm_Library_Error')}</span>
      <button class="link" onclick={() => catalogue.refresh()}>{text('Rpm_Library_Retry')}</button>
    </div>
  {/if}

  {#if library.state === 'ready' && library.albums.length > 0}
    {#if view === 'table'}
      <TrackTable tracks={hits} />
    {:else if view === 'list'}
      <AlbumList albums={shown} {compact} {grouping} {onOpen} />
    {:else}
      <AlbumWall albums={shown} {target} {compact} />
    {/if}
  {:else if library.state === 'ready'}
    <div class="message">
      <p>{text('Web_LibraryEmpty')}</p>
      <button class="glass-button primary" onclick={onImport}>{text('Queue_Title')}</button>
    </div>
  {:else if library.state === 'failed'}
    <div class="message">
      <p>{text('Rpm_Library_Error')}</p>
      <button class="glass-button" onclick={() => catalogue.refresh()}>{text('Rpm_Library_Retry')}</button>
    </div>
  {:else if library.state === 'reading'}
    <div class="message"><RecordSpinner size={52} /><p>{text('Tv_Library_ReadingCount', library.read)}</p></div>
  {/if}
</div>

<style>
  .collection {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 12px 16px 0;
  }

  .tools {
    display: flex;
    gap: 12px;
    align-items: center;
    height: 28px;
    margin-top: 4px;
  }

  .search {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 150px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
    color: rgb(255 255 255 / 0.6);
    font-size: 12px;
  }

  .search input {
    width: 100%;
    min-width: 0;
    border: 0;
    background: none;
    color: #fff;
    outline: none;
    font-size: 16px;
  }

  .search input::placeholder {
    color: rgb(255 255 255 / 0.47);
  }

  @media (pointer: fine) {
    .search input {
      font-size: 12px;
    }
  }

  /* A key in the library's header: a box 28 high with a hairline, the height of the search beside it. */
  .slot {
    display: flex;
    flex: none;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
  }

  .slot-key {
    display: grid;
    place-items: center;
    width: 32px;
    height: 26px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    cursor: pointer;
  }

  .views .slot-key {
    font-size: 13px;
  }

  .slot-key.on {
    background: var(--selected);
    color: #fff;
  }

  .slot-key:not(.lit) .outline {
    color: var(--favorite-idle);
  }

  .slot-key.lit {
    color: var(--favorite);
  }

  @media (hover: hover) {
    .slot-key:hover {
      background: rgb(255 255 255 / 0.094);
    }

    .slot-key.on:hover {
      background: var(--selected);
    }
  }

  .size {
    display: flex;
    gap: 7px;
    align-items: center;
  }

  .size i {
    display: block;
    flex: none;
    background: rgb(255 255 255 / 0.6);
  }

  .small {
    width: 6.5px;
    height: 7px;
  }

  .big {
    width: 10.5px;
    height: 12px;
  }

  .slim {
    width: 96px;
    height: 14px;
    margin: 0;
    background: none;
    appearance: none;
    cursor: pointer;
  }

  .slim::-webkit-slider-runnable-track {
    height: 3px;
    background: linear-gradient(to right, #fff var(--fill, 0%), rgb(255 255 255 / 0.25) var(--fill, 0%));
  }

  .slim::-moz-range-track {
    height: 3px;
    background: rgb(255 255 255 / 0.25);
  }

  .slim::-moz-range-progress {
    height: 3px;
    background: #fff;
  }

  .slim::-webkit-slider-thumb {
    width: 3px;
    height: 14px;
    margin-top: -5.5px;
    border: 0;
    border-radius: 0;
    background: #fff;
    appearance: none;
  }

  .slim::-moz-range-thumb {
    width: 3px;
    height: 14px;
    border: 0;
    border-radius: 0;
    background: #fff;
  }

  .compact .tools {
    width: 100%;
    margin-top: 0;
  }

  .compact .search {
    flex: 1;
    width: auto;
  }

  .band {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    margin: 0 16px 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
    font-size: 13px;
  }

  .message {
    padding: 24px 16px;
    color: var(--text-soft);
  }

  div.message {
    display: grid;
    gap: 10px;
    justify-items: center;
  }

  div.message p {
    margin: 0;
  }
</style>
