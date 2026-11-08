<script lang="ts">
  import { covers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { trackCount } from '../../strings/counts';
  import { menuOn } from '../menu/menu.svelte';
  import { albumMenu } from './record-menu.svelte';

  // A shelf on a page of its own: the words stand left, and say when and how much in place of who.
  let { album, size, open, onOpen, shelf = false }: { album: CloudAlbum; size: number; open: boolean; onOpen: () => void; shelf?: boolean } = $props();

  let sleeve = $state<string | null>(null);

  // A copy twice the shown size for a sharp picture on a retina screen, rounded up by the store to 256,
  // 512 or 1024.
  const edge = $derived(size * devicePixelRatio > 256 ? 512 : 256);

  $effect(() => {
    const wanted = album;
    let current = true;
    // A cover that was shown before is drawn at once, so a wall opened again is not blank while it asks.
    const known = covers.known(wanted, edge);
    if (known) sleeve = known;
    void covers.url(wanted, edge).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<button class="card" class:shelf onclick={onOpen} use:menuOn={() => albumMenu(album, 'collection')}>
  <span class="art" class:open style:height="{size}px">
    {#if sleeve}<img src={sleeve} alt="" />{:else}<i class="icon">{icons.album}</i>{/if}
  </span>
  <span class="title">{album.album}</span>
  <span class="artist">{shelf ? [album.year, trackCount(album.tracks.length)].filter(Boolean).join('  •  ') : album.artist}</span>
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
    -webkit-touch-callout: none;
  }

  .card.shelf {
    text-align: left;
  }

  .card.shelf .title {
    font-weight: 500;
  }

  .card.shelf .artist {
    color: rgb(255 255 255 / 0.6);
    font-size: 11px;
    white-space: pre;
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
