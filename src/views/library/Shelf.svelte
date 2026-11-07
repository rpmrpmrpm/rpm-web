<script lang="ts">
  // A row of records, as on Home.
  import type { CloudAlbum } from '../../library/albums';
  import AlbumCard from './AlbumCard.svelte';

  let { title, albums, onOpen }: { title: string; albums: CloudAlbum[]; onOpen: (album: CloudAlbum) => void } = $props();

  const SIZE = 150;
</script>

<section>
  <h3>{title}</h3>
  <div class="strip">
    {#each albums as album (album.key)}
      <div class="slot"><AlbumCard {album} size={SIZE} open={false} onOpen={() => onOpen(album)} /></div>
    {/each}
  </div>
</section>

<style>
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 700;
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
    width: 150px;
  }
</style>
