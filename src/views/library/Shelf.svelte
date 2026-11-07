<script lang="ts">
  // A row of records, as on Home.
  import type { CloudAlbum } from '../../library/albums';
  import AlbumCard from './AlbumCard.svelte';

  let { title, albums, onOpen, big = false }: { title: string; albums: CloudAlbum[]; onOpen: (album: CloudAlbum) => void; big?: boolean } = $props();

  const SIZE = 150;
  const BIG_SIZE = 186;
  const size = $derived(big ? BIG_SIZE : SIZE);
</script>

<section>
  <h3 class:shelf-title={big}>{title}</h3>
  <div class="strip">
    {#each albums as album (album.key)}
      <div class="slot" style:width="{size}px"><AlbumCard {album} {size} open={false} shelf={big} onOpen={() => onOpen(album)} /></div>
    {/each}
  </div>
</section>

<style>
  section {
    margin-bottom: 26px;
  }

  h3:not(.shelf-title) {
    margin: 0 0 8px;
    color: rgb(255 255 255 / 0.67);
    font-size: 12px;
    font-weight: 600;
  }

  .strip {
    display: flex;
    gap: 14px;
    padding-bottom: 6px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .slot {
    flex: none;
  }
</style>
