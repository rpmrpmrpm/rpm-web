<script lang="ts">
  // What the library search shows under the bar over the window (SearchOverlay): the recent searches while the box
  // is empty, and what was found, each kind under its own heading (artists, albums, tracks, playlists, genres).
  //
  // A chosen answer opens where the same thing opens from its own view, and a song plays. The bar is told what to
  // bring up (onShow) and that the choice is made (onDone).
  //
  // One row is lit for the keyboard (lit, an index into the rows from the top). The bar moves it with the arrows,
  // and Enter presses the row marked .lit.
  import { tick } from 'svelte';

  import { artistArt, covers, player } from '../../app';
  import type { CloudTrack } from '../../api/wire';
  import { icons } from '../../design/icons';
  import { ownAlbums } from '../../library/artists';
  import { SONG_CEILING } from '../../library/search';
  import { text } from '../../strings/loc';
  import { pages, type LibraryMode } from '../library/pages.svelte';
  import { asked } from '../library/record-menu.svelte';
  import { FIRST_SHOWN, librarySearch, nothingFound } from './library-search.svelte';
  import SearchThumb from './SearchThumb.svelte';
  import { genreName } from './sources';

  let {
    onShow,
    onDone,
    onAgain,
    lit,
    count = $bindable(0),
  }: {
    // Brings up a view of the library for an answer that lives there, or a record's page ('record').
    onShow: (where: LibraryMode | 'record') => void;
    // After any choice, once the search has gone away.
    onDone: () => void;
    // A recent search was pressed: the host puts it back in its box.
    onAgain: (entry: string) => void;
    // The row lit for the keyboard, from the top.
    lit: number;
    // How many rows there are to light.
    count?: number;
  } = $props();

  let root = $state<HTMLElement | null>(null);

  const found = $derived(librarySearch.found);
  const recent = $derived(librarySearch.history.entries);
  const showsRecent = $derived(librarySearch.showsRecent);

  const shownOf = <T,>(group: string, answers: readonly T[]) => (librarySearch.unfolded.has(group) ? answers : answers.slice(0, FIRST_SHOWN));

  // The rows as drawn, and where each group's first row is in the order the keyboard walks them.
  const shown = $derived(
    found && !nothingFound(found)
      ? {
          artists: shownOf('artists', found.artists),
          records: shownOf('records', found.records),
          songs: shownOf('songs', found.songs),
          lists: shownOf('lists', found.lists),
          genres: shownOf('genres', found.genres),
        }
      : null,
  );
  const starts = $derived.by(() => {
    if (!shown) return null;
    const records = shown.artists.length;
    const songs = records + shown.records.length;
    const lists = songs + shown.songs.length;
    const genres = lists + shown.lists.length;
    return { artists: 0, records, songs, lists, genres, end: genres + shown.genres.length };
  });

  $effect(() => {
    count = showsRecent ? recent.length : (starts?.end ?? 0);
  });

  // The lit row stays in view as the arrows move it.
  $effect(() => {
    if (lit < 0) return;
    void tick().then(() => root?.querySelector('.answer.lit')?.scrollIntoView({ block: 'nearest' }));
  });

  // The song straight after the one playing, and on to it, so the queue stays. With nothing playing it starts
  // inside the press, as the browser asks.
  async function playSong(track: CloudTrack) {
    if (!player.current || player.stopped) {
      player.play([track], 0, { inAlbumOrder: false });
      return;
    }
    await player.playNext([track]);
    if (player.queue[player.index + 1]?.track === track) player.next();
  }

  // A record's page stands over every view, so an answer that opens a view closes one that is open.
  function toView(mode: LibraryMode) {
    asked.opening = null;
    onShow(mode);
  }

  function done() {
    librarySearch.chosen();
    onDone();
  }

  const albumsLine = (count: number) => (count === 1 ? text('Stats_AlbumsOne') : text('Stats_Albums', count));
  const tracksLine = (count: number) => (count === 1 ? text('Rpm_Album_TracksOne') : text('Rpm_Album_Tracks', count));
  const more = (group: string, count: number) => (count > FIRST_SHOWN ? text(librarySearch.unfolded.has(group) ? 'Library_SearchViewLess' : 'Library_SearchViewMore') : null);
</script>

{#snippet heading(title: string, toggle: string | null, onToggle: () => void)}
  <div class="heading-line">
    <h4>{title}</h4>
    {#if toggle}<button class="word" onclick={onToggle}>{toggle}</button>{/if}
  </div>
{/snippet}

{#snippet row(index: number, title: string, line: string, end: string | null, thumb: { load?: () => Promise<string | null>; glyph: string; round?: boolean }, choose: () => void)}
  <button class="answer" class:lit={index === lit} aria-label={line ? `${title}, ${line}` : title} onclick={choose}>
    <SearchThumb load={thumb.load ?? null} glyph={thumb.glyph} round={thumb.round} />
    <span class="words">
      <span class="title">{title}</span>
      {#if line}<span class="line">{line}</span>{/if}
    </span>
    {#if end}<span class="end">{end}</span>{/if}
  </button>
{/snippet}

<div class="answers" bind:this={root}>
  {#if showsRecent}
    {@render heading(text('Rpm_Search_Recent'), text('Rpm_Search_ClearRecent'), () => librarySearch.history.clear())}
    {#each recent as entry, index (entry)}
      <div class="recent">
        <button class="answer again" class:lit={index === lit} onclick={() => onAgain(entry)}>
          <i class="icon">{icons.search}</i><span class="title">{entry}</span>
        </button>
        <button class="forget" title={text('Rpm_Search_Forget')} aria-label={text('Rpm_Search_Forget')} onclick={() => librarySearch.history.forget(entry)}><i class="icon">{icons.close}</i></button>
      </div>
    {/each}
  {:else if found && nothingFound(found)}
    <p class="nothing">{text('Library_NoSearchResults')}</p>
  {:else if found && shown && starts}
    {#if shown.artists.length}
      {@render heading(text('Artists_Title'), more('artists', found.artists.length), () => librarySearch.toggle('artists'))}
      {#each shown.artists as artist, index (artist.name)}
        {@render row(starts.artists + index, artist.name, albumsLine(ownAlbums(artist).length), null, { load: () => artistArt.photo(artist.name), glyph: icons.artist, round: true }, () => {
          pages.artist = artist.name;
          toView('artists');
          done();
        })}
      {/each}
    {/if}
    {#if shown.records.length}
      {@render heading(text('Viz_BrowseAlbums'), more('records', found.records.length), () => librarySearch.toggle('records'))}
      {#each shown.records as album, index (album.key)}
        {@render row(starts.records + index, album.album, album.artist, tracksLine(album.tracks.length), { load: () => covers.url(album, 128), glyph: icons.album }, () => {
          asked.opening = album;
          onShow('record');
          done();
        })}
      {/each}
    {/if}
    {#if shown.songs.length}
      {@render heading(text('Album_Tracks'), more('songs', found.songs.length), () => librarySearch.toggle('songs'))}
      {#each shown.songs as hit, index (hit.track.rpmId)}
        {@render row(starts.songs + index, hit.track.title || hit.track.relativePath || '', hit.track.artist ?? hit.track.tags?.albumArtist ?? '', null, { load: () => covers.url(hit.album, 128), glyph: icons.album }, () => {
          void playSong(hit.track);
          done();
        })}
      {/each}
      {#if found.songs.length >= SONG_CEILING && librarySearch.unfolded.has('songs')}
        <p class="ceiling">{text('Rpm_Library_SearchCeiling', SONG_CEILING)}</p>
      {/if}
    {/if}
    {#if shown.lists.length}
      {@render heading(text('Playlists_Title'), more('lists', found.lists.length), () => librarySearch.toggle('lists'))}
      {#each shown.lists as list, index (index)}
        {@render row(starts.lists + index, list.name, list.line, null, { glyph: icons.playlist }, () => {
          pages.playlist = list.kind === 'list' ? { kind: 'list', id: list.list.playlistId } : { kind: 'generated', list: list.list };
          toView('playlists');
          done();
        })}
      {/each}
    {/if}
    {#if shown.genres.length}
      {@render heading(text('Genres_Title'), more('genres', found.genres.length), () => librarySearch.toggle('genres'))}
      {#each shown.genres as genre, index (genre.name)}
        {@render row(starts.genres + index, genreName(genre.name), albumsLine(genre.albums.length), null, { glyph: icons.music }, () => {
          pages.genre = genre.name;
          toView('genres');
          done();
        })}
      {/each}
    {/if}
  {/if}
</div>

<style>
  /* No box of its own: the host's panel lays the rows out. */
  .answers {
    display: contents;
  }

  /* Every heading on the panel is the cards' block heading: 12, semibold, at the quiet ink. */
  .heading-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 12px 10px 4px 16px;
  }

  h4 {
    margin: 0;
    color: rgb(255 255 255 / 0.667);
    font-size: 12px;
    font-weight: 600;
  }

  .word {
    padding: 3px 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    cursor: pointer;
  }

  .answer {
    display: flex;
    gap: 12px;
    align-items: center;
    box-sizing: border-box;
    width: calc(100% - 12px);
    min-height: 52px;
    margin: 0 6px;
    padding: 6px 12px 6px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: #fff;
    text-align: left;
    cursor: pointer;
  }

  .answer:active,
  .word:active,
  .forget:active {
    background: rgb(255 255 255 / 0.118);
  }

  @media (hover: hover) {
    .answer:hover,
    .word:hover,
    .forget:hover {
      background: rgb(255 255 255 / 0.071);
    }
  }

  /* The row Enter presses in the bar over the window. Brighter than the pointer's wash, so the two read apart. */
  .answer.lit {
    background: rgb(255 255 255 / 0.11);
  }

  .answer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .title,
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 14px;
  }

  .line {
    color: rgb(255 255 255 / 0.533);
    font-size: 12px;
  }

  .end {
    flex: none;
    color: rgb(255 255 255 / 0.4);
    font-size: 12px;
  }

  .recent {
    position: relative;
  }

  .answer.again {
    min-height: 40px;
    padding: 4px 36px 4px 10px;
  }

  .again .icon {
    color: rgb(255 255 255 / 0.467);
    font-size: 11px;
  }

  .forget {
    position: absolute;
    top: 50%;
    right: 10px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: rgb(255 255 255 / 0.467);
    font-size: 10px;
    transform: translateY(-50%);
    cursor: pointer;
  }

  .nothing {
    margin: 28px 0 22px;
    color: rgb(255 255 255 / 0.533);
    font-size: 13px;
    text-align: center;
  }

  .ceiling {
    margin: 10px 24px 6px;
    color: rgb(255 255 255 / 0.467);
    font-size: 12px;
    text-align: center;
  }
</style>
