<script lang="ts" module>
  // Whether the wall is narrowed to the acts something of whom is hearted. Held here and not in the view, so it
  // stays on while the view is taken down and put back up during a visit.
  const heart = $state({ only: false });
</script>

<script lang="ts">
  // Artists: everyone the collection files a record under, and each one's page. The heading has the heart, which
  // narrows the wall to the hearted acts, and the card size.
  import { favorites } from '../../app';
  import type { CloudAlbum } from '../../library/albums';
  import { favoriteArtists, initialOf, ownAlbums, sortArtists, type ArtistWallItem } from '../../library/artists';
  import { albumsByKey, artistWall } from '../../library/walls';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import AlphabetRail from './AlphabetRail.svelte';
  import ArtistPage from './ArtistPage.svelte';
  import ArtistTile from './ArtistTile.svelte';
  import HeartKey from './HeartKey.svelte';
  import { pages } from './pages.svelte';
  import SizeSlider from './SizeSlider.svelte';
  import { ARTISTS_SIZE_KEY, FIRST_TARGET, keepTarget, LARGEST_TARGET, SMALLEST_TARGET, storedTarget, WALL_GAP, wallColumns } from './wall-size';

  let { onOpen, compact = false }: { onOpen: (album: CloudAlbum) => void; compact?: boolean } = $props();

  let scroller = $state<HTMLElement | null>(null);
  let lit = $state('');
  let target = $state(storedTarget(ARTISTS_SIZE_KEY));
  let width = $state(0);

  // On a phone the slider is not shown, so the wall keeps the first size.
  const columns = $derived(wallColumns(width, compact ? FIRST_TARGET : target));

  const held = $derived(albumsByKey(library.albums));
  const every = $derived(artistWall(library.albums));
  const sorted = $derived(sortArtists(every, 'Name', held));

  // The acts something of whom is hearted, while the heart is on. Worked out again when a heart is given or taken
  // anywhere (marksVersion) and when the collection changes. Until the first answer comes, and if it cannot be
  // worked out, the wall stays whole.
  let hearted = $state.raw<ReadonlySet<string> | null>(null);
  $effect(() => {
    void library.marksVersion;
    const albums = library.albums;
    const wall = every;
    if (!heart.only) {
      hearted = null;
      return;
    }
    let current = true;
    void favorites.albumsMarked(albums).then(
      (marked) => {
        if (!current) return;
        const credits = albums.flatMap((album) => album.tracks.filter((track) => favorites.marks.isMarked(track.rpmId)).map((track) => track.artist));
        hearted = favoriteArtists(wall, marked, credits);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  });

  // The search answers in its own bar (SearchOverlay) and does not narrow the wall.
  const shown = $derived(heart.only && hearted ? sorted.filter((artist) => hearted!.has(artist.name)) : sorted);
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
      <div class="tools">
        <HeartKey on={heart.only} label={text('Artists_FavoritesOnly')} onToggle={() => (heart.only = !heart.only)} />
        {#if !compact}
          <SizeSlider bind:value={target} min={SMALLEST_TARGET} max={LARGEST_TARGET} label={text('Library_CardSize')} onchange={() => keepTarget(ARTISTS_SIZE_KEY, target)} />
        {/if}
      </div>
    </header>

    <div class="scroller" bind:this={scroller} onscroll={followScroll}>
      {#if shown.length}
        <div class="tiles" bind:clientWidth={width} style:grid-template-columns="repeat({columns}, minmax(0, 1fr))" style:gap="{WALL_GAP}px">
          {#each shown as artist (artist.name)}
            <div data-artist={artist.name}>
              <ArtistTile name={artist.name} album={first(artist)} onOpen={() => (pages.artist = artist.name)} />
            </div>
          {/each}
        </div>
      {:else if library.state === 'ready' && !heart.only}
        <p class="empty">{text('Artists_Empty')}</p>
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

  .scroller {
    flex: 1;
    min-height: 0;
    padding: 2px 26px 20px 0;
    overflow-y: auto;
  }

  /* The columns and the gap are set on the element, from the card size (wallColumns). */
  .tiles {
    display: grid;
  }

  .tools {
    display: flex;
    flex: none;
    gap: 12px;
    align-items: center;
    height: 28px;
    margin-top: 4px;
  }

  .empty {
    color: rgb(255 255 255 / 0.55);
    font-size: 13px;
    text-align: center;
  }
</style>
