<script lang="ts">
  // The library search's box in a view's heading, and the panel it opens. Folded, the box is the magnifier key
  // alone; pressed, it slides out to the left and takes the keyboard. It grows to the left because every heading
  // it is in lays its keys out from the right, so the keys to its right stay where they are.
  //
  // What is typed is answered in a panel that drops down under the heading, from the box's left edge to the right
  // edge of the heading's last key (edge), and down to at most the foot of the card. A press on the card below the
  // heading puts the search away, as a press beside a menu does. The recent searches stand there while the box is
  // empty.
  import { onMount, tick } from 'svelte';

  import { artistArt, covers, player, playlists } from '../../app';
  import type { CloudTrack } from '../../api/wire';
  import { icons } from '../../design/icons';
  import { ownAlbums } from '../../library/artists';
  import { UNCLASSIFIED } from '../../library/genres';
  import { SONG_CEILING } from '../../library/search';
  import { artistWall, genreWall } from '../../library/walls';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { pages, type LibraryMode } from '../library/pages.svelte';
  import { asked } from '../library/record-menu.svelte';
  import { FIRST_SHOWN, librarySearch, nothingFound, type FoundList } from './library-search.svelte';
  import SearchThumb from './SearchThumb.svelte';

  let {
    id,
    edge,
    onPick,
    openWidth = 150,
  }: {
    // Which heading this box is in. One search is open at a time, under one box.
    id: LibraryMode;
    // The heading's last key, or the row of keys: the panel's right edge is its right edge.
    edge: HTMLElement | null;
    // Shows a view of the library, for an answer that lives in another view.
    onPick: (mode: LibraryMode) => void;
    openWidth?: number;
  } = $props();

  // The narrowest the panel is drawn. Where the box is the heading's only key, the panel reaches further left.
  const LEAST_WIDTH = 420;
  // The gap between the heading's row and the panel.
  const UNDER_HEADING = 10;

  let unfolded = $state(false);
  let words = $state('');
  let box = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let place = $state({ left: 0, top: 0, width: 0, height: 0, card: { left: 0, top: 0, width: 0, height: 0 } });

  const open = $derived(librarySearch.from === id);
  const found = $derived(librarySearch.found);
  const showsRecent = $derived(!librarySearch.asked.trim() || found === null);
  const recent = $derived(librarySearch.history.entries);
  const caughtUp = $derived(librarySearch.foundFor.toLocaleLowerCase() === librarySearch.asked.trim().toLocaleLowerCase());
  const showsAnything = $derived(open && (showsRecent ? recent.length > 0 : found !== null && (!nothingFound(found) || caughtUp)));

  // Another box took the search, or it was put away: this one empties and folds. Only on that change, not while
  // the box is out and the search has not opened under it yet.
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (wasOpen && !isOpen && unfolded) fold();
    wasOpen = isOpen;
  });

  const genreName = (name: string) => (name === UNCLASSIFIED ? text('Queue_ChipNotIdentified') : name);

  const sources = () => ({ albums: library.albums, artists: artistWall(library.albums), genres: genreWall(library.albums), genreName });

  // Every list the playlists view offers by name: the ones the listener made, each with the folder it is filed
  // in, and the ones made for them.
  async function readLists(): Promise<FoundList[]> {
    const [held, made] = await Promise.all([playlists.list(), playlists.generated().catch(() => [])]);
    return [
      ...held.map((list): FoundList => ({ kind: 'list', list, name: list.name, line: list.folder.at(-1) ?? '' })),
      ...made.map((list): FoundList => ({ kind: 'generated', list, name: list.title ?? list.kind, line: '' })),
    ];
  }

  // The field is drawn once this change is, so it takes the keyboard after that.
  function unfold() {
    unfolded = true;
    void tick().then(() => field?.focus());
  }

  function fold() {
    words = '';
    unfolded = false;
  }

  function openHere() {
    librarySearch.open(id, sources, readLists);
    queueMicrotask(measure);
  }

  function typed() {
    // Emptied on the way out: nothing to search, and nothing to open.
    if (!open && words.length === 0) return;
    if (!open) openHere();
    librarySearch.ask(words);
  }

  function dismiss() {
    librarySearch.close();
    fold();
  }

  // The keyboard went elsewhere with nothing typed and nothing on the panel to press: the box folds. Not while the
  // panel shows the recent searches, because a press on one of them takes the keyboard on its way to being a
  // click.
  function left() {
    setTimeout(() => {
      if (words.length > 0 || showsAnything || document.activeElement === field) return;
      if (open) librarySearch.close();
      fold();
    });
  }

  function keyed(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      panel?.querySelector<HTMLElement>('.answer')?.focus();
    }
  }

  // Under the heading, from the box's left edge to the right edge of the heading's last key, and down to at most
  // the card's foot. The catcher starts just under the heading, so the box and the heading's other keys stay in
  // reach.
  function measure() {
    if (!box || !open) return;
    const at = box.getBoundingClientRect();
    const card = (box.closest('.pane, main') ?? document.body).getBoundingClientRect();
    const end = edge?.getBoundingClientRect().right ?? at.right;
    const right = Math.min(end, card.right - 8);
    const left = Math.max(card.left + 8, Math.min(at.left, right - LEAST_WIDTH));
    const top = at.bottom + UNDER_HEADING;
    place = {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(160, card.bottom - top - 12),
      card: { left: card.left, top: top - UNDER_HEADING / 2, width: card.width, height: Math.max(0, card.bottom - top + UNDER_HEADING / 2) },
    };
  }

  // The box slides out and the panel's left edge goes with it; the pane can change width too.
  onMount(() => {
    const watch = new ResizeObserver(measure);
    watch.observe(box!);
    const card = box!.closest('.pane, main');
    if (card) watch.observe(card);
    addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      removeEventListener('resize', measure);
      if (librarySearch.from === id) librarySearch.close();
    };
  });

  // At the root of the page, because a pane's blur makes it the frame that fixed positions are measured from.
  function atRoot(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  // ── what a chosen answer does: each opens where the same thing opens from its own view, and a song plays ──

  function done() {
    librarySearch.chosen();
    fold();
  }

  function toView(mode: LibraryMode) {
    asked.opening = null;
    onPick(mode);
  }

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

  const albumsLine = (count: number) => (count === 1 ? text('Stats_AlbumsOne') : text('Stats_Albums', count));
  const tracksLine = (count: number) => (count === 1 ? text('Rpm_Album_TracksOne') : text('Rpm_Album_Tracks', count));
  const shownOf = <T,>(group: string, answers: readonly T[]) => (librarySearch.unfolded.has(group) ? answers : answers.slice(0, FIRST_SHOWN));
</script>

<div class="box" class:unfolded bind:this={box} style:--open="{openWidth}px">
  <button class="lens" title={text('Lookup_SearchButton')} aria-label={text('Lookup_SearchButton')} onclick={() => (unfolded ? field?.focus() : unfold())}>
    <i class="icon">{icons.search}</i>
  </button>
  {#if unfolded}
    <input
      bind:this={field}
      bind:value={words}
      type="text"
      enterkeyhint="search"
      autocomplete="off"
      spellcheck="false"
      placeholder={text('Lookup_SearchButton')}
      aria-label={text('Lookup_SearchButton')}
      oninput={typed}
      onfocus={openHere}
      onblur={left}
      onkeydown={keyed}
    />
    {#if words}
      <button class="clear" title={text('Artists_SearchClear')} aria-label={text('Artists_SearchClear')} onclick={dismiss}><i class="icon">{icons.close}</i></button>
    {/if}
  {/if}
</div>

{#snippet heading(title: string, toggle: string | null, onToggle: () => void)}
  <div class="heading-line">
    <h4>{title}</h4>
    {#if toggle}<button class="word" onclick={onToggle}>{toggle}</button>{/if}
  </div>
{/snippet}

{#snippet row(title: string, line: string, end: string | null, thumb: { load?: () => Promise<string | null>; glyph: string; round?: boolean }, choose: () => void)}
  <button class="answer" aria-label={line ? `${title}, ${line}` : title} onclick={choose}>
    <SearchThumb load={thumb.load ?? null} glyph={thumb.glyph} round={thumb.round} />
    <span class="words">
      <span class="title">{title}</span>
      {#if line}<span class="line">{line}</span>{/if}
    </span>
    {#if end}<span class="end">{end}</span>{/if}
  </button>
{/snippet}

{#if open && showsAnything}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="catcher" use:atRoot style:left="{place.card.left}px" style:top="{place.card.top}px" style:width="{place.card.width}px" style:height="{place.card.height}px" onpointerdown={dismiss}></div>
  <div class="panel" use:atRoot bind:this={panel} role="listbox" aria-label={text('Lookup_SearchButton')} style:left="{place.left}px" style:top="{place.top}px" style:width="{place.width}px" style:max-height="{place.height}px">
    {#if showsRecent}
      {@render heading(text('Rpm_Search_Recent'), text('Rpm_Search_ClearRecent'), () => librarySearch.history.clear())}
      {#each recent as entry (entry)}
        <div class="recent">
          <button
            class="answer again"
            onclick={() => {
              words = entry;
              librarySearch.ask(entry);
              field?.focus();
            }}
          >
            <i class="icon">{icons.search}</i><span class="title">{entry}</span>
          </button>
          <button class="forget" title={text('Rpm_Search_Forget')} aria-label={text('Rpm_Search_Forget')} onclick={() => librarySearch.history.forget(entry)}><i class="icon">{icons.close}</i></button>
        </div>
      {/each}
    {:else if found && nothingFound(found)}
      <p class="nothing">{text('Library_NoSearchResults')}</p>
    {:else if found}
      {@const more = (group: string, count: number) => (count > FIRST_SHOWN ? text(librarySearch.unfolded.has(group) ? 'Library_SearchViewLess' : 'Library_SearchViewMore') : null)}
      {#if found.artists.length}
        {@render heading(text('Artists_Title'), more('artists', found.artists.length), () => librarySearch.toggle('artists'))}
        {#each shownOf('artists', found.artists) as artist (artist.name)}
          {@render row(artist.name, albumsLine(ownAlbums(artist).length), null, { load: () => artistArt.photo(artist.name), glyph: icons.artist, round: true }, () => {
            pages.artist = artist.name;
            toView('artists');
            done();
          })}
        {/each}
      {/if}
      {#if found.records.length}
        {@render heading(text('Viz_BrowseAlbums'), more('records', found.records.length), () => librarySearch.toggle('records'))}
        {#each shownOf('records', found.records) as album (album.key)}
          {@render row(album.album, album.artist, tracksLine(album.tracks.length), { load: () => covers.url(album, 128), glyph: icons.album }, () => {
            asked.opening = album;
            done();
          })}
        {/each}
      {/if}
      {#if found.songs.length}
        {@render heading(text('Album_Tracks'), more('songs', found.songs.length), () => librarySearch.toggle('songs'))}
        {#each shownOf('songs', found.songs) as hit (hit.track.rpmId)}
          {@render row(hit.track.title || hit.track.relativePath || '', hit.track.artist ?? hit.track.tags?.albumArtist ?? '', null, { load: () => covers.url(hit.album, 128), glyph: icons.album }, () => {
            void playSong(hit.track);
            done();
          })}
        {/each}
        {#if found.songs.length >= SONG_CEILING && librarySearch.unfolded.has('songs')}
          <p class="ceiling">{text('Rpm_Library_SearchCeiling', SONG_CEILING)}</p>
        {/if}
      {/if}
      {#if found.lists.length}
        {@render heading(text('Playlists_Title'), more('lists', found.lists.length), () => librarySearch.toggle('lists'))}
        {#each shownOf('lists', found.lists) as list, index (index)}
          {@render row(list.name, list.line, null, { glyph: icons.playlist }, () => {
            pages.playlist = list.kind === 'list' ? { kind: 'list', id: list.list.playlistId } : { kind: 'generated', list: list.list };
            toView('playlists');
            done();
          })}
        {/each}
      {/if}
      {#if found.genres.length}
        {@render heading(text('Genres_Title'), more('genres', found.genres.length), () => librarySearch.toggle('genres'))}
        {#each shownOf('genres', found.genres) as genre (genre.name)}
          {@render row(genreName(genre.name), albumsLine(genre.albums.length), null, { glyph: icons.music }, () => {
            pages.genre = genre.name;
            toView('genres');
            done();
          })}
        {/each}
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* The frosted slot the album header's search always wore: 28 high, a hairline, 6 round. */
  .box {
    display: flex;
    flex: none;
    gap: 2px;
    align-items: center;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    padding-right: 4px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.133);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.06);
    transition: width 200ms cubic-bezier(0.215, 0.61, 0.355, 1);
  }

  .box.unfolded {
    width: var(--open);
  }

  @media (prefers-reduced-motion: reduce) {
    .box {
      transition: none;
    }
  }

  .lens {
    display: grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: rgb(255 255 255 / 0.7);
    font-size: 12px;
    cursor: pointer;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font-size: 16px;
    outline: none;
  }

  /* 12 on a computer; 16 on a touch screen, where a smaller field makes the phone zoom in. */
  @media (pointer: fine) {
    input {
      font-size: 12px;
    }
  }

  input::placeholder {
    color: rgb(255 255 255 / 0.47);
  }

  .clear {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: rgb(255 255 255 / 0.6);
    font-size: 10px;
    cursor: pointer;
  }

  @media (hover: hover) {
    .lens:hover {
      background: rgb(255 255 255 / 0.094);
    }

    .clear:hover {
      background: rgb(255 255 255 / 0.133);
    }
  }

  .catcher {
    position: fixed;
    z-index: 15;
    background: rgb(0 0 0 / 0.15);
  }

  /* The surface of the app's menus, so the panel reads as one of them. It comes down a few points and up from
     clear, in the time a menu takes. */
  .panel {
    position: fixed;
    z-index: 16;
    box-sizing: border-box;
    padding: 4px 0 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid rgb(255 255 255 / 0.094);
    border-radius: 8px;
    background: rgb(38 47 64 / 0.96);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(30px);
    color: #fff;
    animation:
      fade 140ms cubic-bezier(0.215, 0.61, 0.355, 1),
      drop 180ms cubic-bezier(0.215, 0.61, 0.355, 1);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes drop {
    from {
      transform: translateY(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
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
