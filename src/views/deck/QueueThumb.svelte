<script lang="ts">
  // The record's cover at the front of a Now playing row, over a plate with the disc glyph. A queue can be thousands
  // of rows long, so the cover is asked for only once the row comes into view.
  import { onMount } from 'svelte';

  import { covers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';

  let { album }: { album: CloudAlbum | null } = $props();

  let plate = $state<HTMLElement | null>(null);
  let seen = $state(false);
  let picture = $state<string | null>(null);

  onMount(() => {
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        seen = true;
        watch.disconnect();
      }
    });
    watch.observe(plate!);
    return () => watch.disconnect();
  });

  $effect(() => {
    const wanted = album;
    let current = true;
    picture = wanted ? covers.known(wanted, 128) : null;
    if (wanted && seen)
      void covers.url(wanted, 128).then((url) => {
        if (current) picture = url;
      });
    return () => {
      current = false;
    };
  });
</script>

<span class="thumb" bind:this={plate}>
  <i class="icon">{icons.album}</i>
  {#if picture}<img src={picture} alt="" />{/if}
</span>

<style>
  .thumb {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.2);
  }

  .icon {
    color: rgb(255 255 255 / 0.25);
    font-size: 14px;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
