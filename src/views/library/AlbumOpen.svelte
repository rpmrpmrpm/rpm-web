<script lang="ts">
  // A record opened from anywhere but the wall: a page on a phone, a window on a computer.
  import type { CloudAlbum } from '../../library/albums';
  import Window from '../import/Window.svelte';
  import AlbumDetail from './AlbumDetail.svelte';
  import AlbumPage from './AlbumPage.svelte';

  let { album, compact, onClose }: { album: CloudAlbum; compact: boolean; onClose: () => void } = $props();
</script>

{#if compact}
  <AlbumPage {album} {onClose} />
{:else}
  <Window title={album.album} wide {onClose}>
    <AlbumDetail {album} />
  </Window>
{/if}
