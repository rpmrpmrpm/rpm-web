<script lang="ts">
  // The wall. It knows where every row is, because every row is the same height except the one with
  // its drawer open, so only the rows near the view exist. On a phone an album opens its own page.
  import type { CloudAlbum } from '../../library/albums';
  import AlbumBand from './AlbumBand.svelte';
  import AlbumCard from './AlbumCard.svelte';
  import AlbumPage from './AlbumPage.svelte';

  let { albums, target, compact = false }: { albums: CloudAlbum[]; target: number; compact?: boolean } = $props();

  const GAP = 16;
  const PADDING = 16;
  const WORDS = 58;
  const OVERSCAN = 2;

  let width = $state(0);
  let viewport = $state(0);
  let scroll = $state(0);
  let bandHeight = $state(0);
  let open = $state<CloudAlbum | null>(null);

  const usable = $derived(Math.max(0, width - PADDING * 2));
  const columns = $derived(compact ? 2 : Math.max(1, Math.round((usable + GAP) / (target + GAP))));
  const art = $derived(Math.max(1, (usable - GAP * (columns - 1)) / columns));
  const rowHeight = $derived(art + WORDS + GAP);
  const rows = $derived(Math.ceil(albums.length / columns));

  const openIndex = $derived(open ? albums.indexOf(open) : -1);
  const openRow = $derived(!compact && openIndex >= 0 ? Math.floor(openIndex / columns) : -1);
  const drawer = $derived(openRow >= 0 ? bandHeight + GAP : 0);

  const top = (row: number) => row * rowHeight + (openRow >= 0 && row > openRow ? drawer : 0);

  const firstRow = $derived.by(() => {
    let row = Math.floor(scroll / rowHeight);
    if (openRow >= 0 && row > openRow) row = openRow + Math.max(0, Math.floor((scroll - top(openRow + 1)) / rowHeight)) + 1;
    return Math.max(0, row - OVERSCAN);
  });

  const visible = $derived.by(() => {
    const out: { album: CloudAlbum; row: number; column: number }[] = [];
    const lastRow = Math.min(rows - 1, firstRow + Math.ceil(viewport / rowHeight) + OVERSCAN * 2 + 1);
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = 0; column < columns; column++) {
        const album = albums[row * columns + column];
        if (album) out.push({ album, row, column });
      }
    }
    return out;
  });

  const toggle = (album: CloudAlbum) => (open = open === album ? null : album);
</script>

<div class="scroller" bind:clientWidth={width} bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
  <div class="rows" style:height="{Math.max(0, rows * rowHeight + drawer)}px">
    {#each visible as { album, row, column } (album.key)}
      <div class="slot" style:transform="translate({PADDING + column * (art + GAP)}px, {top(row)}px)" style:width="{art}px">
        <AlbumCard {album} size={art} open={album === open} onOpen={() => toggle(album)} />
      </div>
    {/each}

    {#if open && openRow >= 0}
      <div class="drawer" style:top="{top(openRow) + rowHeight - GAP / 2}px" bind:clientHeight={bandHeight}>
        <AlbumBand album={open} />
      </div>
    {/if}
  </div>
</div>

{#if open && compact}
  <AlbumPage album={open} onClose={() => (open = null)} />
{/if}

<style>
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    contain: strict;
  }

  .rows {
    position: relative;
  }

  .slot {
    position: absolute;
    top: 0;
    left: 0;
    contain: layout style;
  }

  .drawer {
    position: absolute;
    right: 16px;
    left: 16px;
  }
</style>
