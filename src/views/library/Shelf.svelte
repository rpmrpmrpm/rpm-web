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
  section {
    margin-bottom: 26px;
  }

  h3 {
    margin: 0 0 8px;
    color: rgb(255 255 255 / 0.8);
    font-size: 12.5px;
    font-weight: 400;
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
