<script lang="ts">
  // A small cover, for a row.
  import { covers } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';

  let { album, size = 44 }: { album: CloudAlbum | undefined; size?: number } = $props();

  let picture = $state<string | null>(null);

  $effect(() => {
    const wanted = album;
    picture = null;
    if (!wanted) return;
    let current = true;
    void covers.url(wanted, 256).then((url) => {
      if (current) picture = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<span class="sleeve" style:width="{size}px" style:height="{size}px">
  {#if picture}<img src={picture} alt="" loading="lazy" />{:else}<i class="icon">{icons.album}</i>{/if}
</span>

<style>
  .sleeve {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.08);
    color: var(--text-faint);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
