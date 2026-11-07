<script lang="ts">
  // A record on a phone: a page of its own over the wall.
  import { covers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { text } from '../../strings/loc';
  import AlbumDetail from './AlbumDetail.svelte';

  let { album, onClose }: { album: CloudAlbum; onClose: () => void } = $props();

  let sleeve = $state<string | null>(null);

  $effect(() => {
    const wanted = album;
    let current = true;
    void covers.url(wanted, 1024).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<section class="page">
  <button class="key" title={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.back}</i></button>
  {#if sleeve}<img src={sleeve} alt="" />{/if}
  <AlbumDetail {album} columns={1} rating />
</section>

<style>
  .page {
    position: fixed;
    inset: 0 0 calc(56px + env(safe-area-inset-bottom));
    z-index: 3;
    padding: max(8px, env(safe-area-inset-top)) 16px 90px;
    overflow-y: auto;
    background: #080a10;
  }

  img {
    display: block;
    width: 100%;
    max-width: 420px;
    margin: 4px auto 16px;
    border-radius: 10px;
  }
</style>
