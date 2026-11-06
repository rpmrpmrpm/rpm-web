<script lang="ts">
  import { covers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';

  let { album, size, open, onOpen }: { album: CloudAlbum; size: number; open: boolean; onOpen: () => void } = $props();

  let sleeve = $state<string | null>(null);

  // A copy twice the shown size for a sharp picture on a retina screen, rounded up by the store to 256,
  // 512 or 1024.
  const edge = $derived(size * devicePixelRatio > 256 ? 512 : 256);

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, edge).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<button class="card" onclick={onOpen}>
  <span class="art" class:open style:height="{size}px">
    {#if sleeve}<img src={sleeve} alt="" loading="lazy" />{:else}<i class="icon">{icons.album}</i>{/if}
  </span>
  <span class="title">{album.album}</span>
  <span class="artist">{album.artist}</span>
</button>

<style>
  .card {
    display: grid;
    gap: 3px;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: center;
    cursor: pointer;
  }

  .art {
    display: grid;
    place-items: center;
    overflow: hidden;
    margin-bottom: 6px;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 6px;
    background: rgb(255 255 255 / 0.05);
    color: rgb(255 255 255 / 0.23);
    font-size: 34px;
  }

  .art.open {
    border-color: rgb(255 255 255 / 0.6);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .title,
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 13px;
    font-weight: 700;
  }

  .artist {
    color: var(--text-soft);
    font-size: 12px;
  }
</style>
