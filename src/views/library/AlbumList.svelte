<script lang="ts" module>
  export type AlbumGrouping = 'None' | 'Artist' | 'Genre' | 'Year';
</script>

<script lang="ts">
  // The album list: each record with its sleeve and its songs, drawn only near the view. A phone has room for a line.
  import type { CloudAlbum } from '../../library/albums';
  import { trackCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import { menuOn } from '../menu/menu.svelte';
  import AlbumBlock from './AlbumBlock.svelte';
  import { albumMenu } from './record-menu.svelte';
  import Sleeve from './Sleeve.svelte';

  let { albums, compact = false, grouping = 'None', onOpen }: { albums: CloudAlbum[]; compact?: boolean; grouping?: AlbumGrouping; onOpen: (album: CloudAlbum) => void } = $props();

  const LINE = 60;
  const EXTRA = 8;
  const BLOCK_AIR = 49;
  const SLEEVE_SIDE = 230;
  const HEAD = 56;
  const ROW = 22;
  const DISC_ROW = 36;
  const HEADING = 40;
  const SIDE = 188;
  // A DVD box stands about 1.4 times its width. Anything taller is cut to this, and anything wider stays square.
  const TALLEST = 1.6;

  let scroll = $state(0);
  let viewport = $state(0);
  let scroller = $state<HTMLElement | null>(null);

  // What each sleeve's picture turned out to be. It is only known once the picture is here, and it decides the height
  // of the block, so what is above the view moves the view by as much, and nothing on screen jumps.
  let shapes = $state.raw<ReadonlyMap<string, number>>(new Map());
  const tallOf = (album: CloudAlbum) => shapes.get(album.key) ?? 1;

  function shapeIs(row: Row, album: CloudAlbum, shape: number) {
    const tall = Math.min(TALLEST, Math.max(1, shape));
    if (tall === tallOf(album)) return;
    const grew = (tall - tallOf(album)) * SIDE;
    shapes = new Map(shapes).set(album.key, tall);
    if (scroller && row.top < scroll) scroller.scrollTop += grew;
  }

  const genreOf = (album: CloudAlbum) => {
    const genres = new Set(album.tracks.map((track) => track.tags?.genre).filter(Boolean));
    return genres.size === 1 ? ([...genres][0] as string) : '';
  };

  const groupOf = (album: CloudAlbum): string => {
    if (grouping === 'Artist') return album.artist;
    if (grouping === 'Genre') return genreOf(album) || text('AlbumGroup_Ungrouped');
    if (grouping === 'Year') return album.year ? String(album.year) : text('AlbumGroup_NoYear');
    return '';
  };

  const blockHeight = (album: CloudAlbum) => {
    const discs = new Set(album.tracks.map((track) => track.tags?.discNumber ?? 1)).size;
    const lines = Math.ceil(album.tracks.length / 2) * ROW + (discs > 1 ? Math.ceil(discs / 2) * DISC_ROW : 0);
    return Math.max(SLEEVE_SIDE + (tallOf(album) - 1) * SIDE, HEAD + lines) + BLOCK_AIR;
  };

  // Gathered records only look gathered when they stand next to each other.
  const ordered = $derived.by(() => {
    if (grouping === 'None') return albums;
    const collator = new Intl.Collator(undefined, { sensitivity: 'accent', numeric: true });
    const rows = [...albums];
    if (grouping === 'Year') return rows.sort((a, b) => (a.year === 0 ? 1 : 0) - (b.year === 0 ? 1 : 0) || b.year - a.year || collator.compare(a.artist, b.artist));
    return rows.sort((a, b) => collator.compare(groupOf(a), groupOf(b)) || collator.compare(a.album, b.album));
  });

  type Row = { key: string; top: number; height: number; heading?: string; album?: CloudAlbum };

  const rows = $derived.by(() => {
    const list: Row[] = [];
    let top = 0;
    let last: string | null = null;
    for (const album of ordered) {
      const group = groupOf(album);
      if (grouping !== 'None' && group !== last) {
        list.push({ key: `heading-${group}`, top, height: HEADING, heading: group });
        top += HEADING;
        last = group;
      }
      const height = blockHeight(album);
      list.push({ key: album.key, top, height, album });
      top += height;
    }
    return { list, height: top };
  });

  const shownBlocks = $derived(rows.list.filter((row) => row.top + row.height > scroll - 600 && row.top < scroll + viewport + 600));

  const first = $derived(Math.max(0, Math.floor(scroll / LINE) - EXTRA));
  const shownLines = $derived(albums.slice(first, first + Math.ceil(viewport / LINE) + EXTRA * 2));
</script>

<div class="list" class:blocks={!compact} bind:this={scroller} bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
  {#if compact}
    <div class="tall" style:height="{albums.length * LINE}px">
      {#each shownLines as album, index (album.key)}
        <button class="line" style:transform="translateY({(first + index) * LINE}px)" style:height="{LINE}px" onclick={() => onOpen(album)} use:menuOn={() => albumMenu(album, 'collection')}>
          <Sleeve {album} />
          <span class="words"><strong>{album.album}</strong><small>{album.artist}</small></span>
          <small class="year">{album.year || ''}</small>
          <small class="count">{trackCount(album.tracks.length)}</small>
        </button>
      {/each}
    </div>
  {:else}
    <div class="tall" style:height="{rows.height}px">
      {#each shownBlocks as row (row.key)}
        <div class="row" style:transform="translateY({row.top}px)" style:height="{row.height}px">
          {#if row.album}
            <AlbumBlock album={row.album} tall={tallOf(row.album)} onTall={(shape) => shapeIs(row, row.album!, shape)} />
          {:else}
            <h3>{row.heading}</h3>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .list.blocks {
    padding: 0 20px;
  }

  .tall {
    position: relative;
  }

  .row {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    padding-bottom: 24px;
  }

  h3 {
    margin: 0;
    padding-top: 12px;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .line {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 0 16px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-touch-callout: none;
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    font-size: 13px;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-weight: 700;
  }

  small {
    color: var(--text-soft);
    font-size: 12px;
  }

  .year,
  .count {
    flex: none;
  }

  @media (max-width: 480px) {
    .count {
      display: none;
    }
  }
</style>
