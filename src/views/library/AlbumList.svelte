<script lang="ts">
  // The album list: the same records as the wall, one to a row, drawn only near the view.
  import type { CloudAlbum } from '../../library/albums';
  import { trackCount } from '../../strings/counts';
  import Sleeve from './Sleeve.svelte';

  let { albums, onOpen }: { albums: CloudAlbum[]; onOpen: (album: CloudAlbum) => void } = $props();

  const LINE = 60;
  const EXTRA = 8;

  let scroll = $state(0);
  let viewport = $state(0);
  const first = $derived(Math.max(0, Math.floor(scroll / LINE) - EXTRA));
  const shown = $derived(albums.slice(first, first + Math.ceil(viewport / LINE) + EXTRA * 2));
</script>

<div class="list" bind:clientHeight={viewport} onscroll={(event) => (scroll = event.currentTarget.scrollTop)}>
  <div class="field" style:height="{albums.length * LINE}px">
    {#each shown as album, index (album.key)}
      <button class="line" style:transform="translateY({(first + index) * LINE}px)" style:height="{LINE}px" onclick={() => onOpen(album)}>
        <Sleeve {album} />
        <span class="words"><strong>{album.album}</strong><small>{album.artist}</small></span>
        <small class="year">{album.year || ''}</small>
        <small class="count">{trackCount(album.tracks.length)}</small>
      </button>
    {/each}
  </div>
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .field {
    position: relative;
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

  small {
    color: var(--text-soft);
    font-size: 11.5px;
    font-weight: 400;
  }

  @media (hover: hover) {
    .line:hover {
      background: rgb(255 255 255 / 0.06);
    }
  }

  @media (max-width: 480px) {
    .count {
      display: none;
    }
  }
</style>
