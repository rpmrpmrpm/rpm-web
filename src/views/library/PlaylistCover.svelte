<script lang="ts">
  // The picture a list wears: the one chosen for it, or four of its records, or the sleeve of the only one.
  import type { CloudTrack } from '../../api/wire';
  import { covers, playlists } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { library } from '../../state.svelte';

  let { id = null, tracks, glyph = icons.playlist, version = 0 }: { id?: string | null; tracks: readonly CloudTrack[]; glyph?: string; version?: number } = $props();

  const MOSAIC = 4;

  let chosen = $state<string | null>(null);
  let sleeves = $state.raw<string[]>([]);

  $effect(() => {
    const wanted = id;
    void version;
    let current = true;
    chosen = null;
    if (wanted) {
      void playlists.picture(wanted).then((url) => {
        if (current) chosen = url;
      });
    }
    return () => {
      current = false;
    };
  });

  // The first records the list opens on, each once.
  const records = $derived.by(() => {
    const byTrack = new Map<string, CloudAlbum>();
    for (const album of library.albums) for (const track of album.tracks) byTrack.set(track.rpmId, album);
    const found = new Set<CloudAlbum>();
    for (const track of tracks) {
      const album = byTrack.get(track.rpmId);
      if (album) found.add(album);
      if (found.size === MOSAIC) break;
    }
    return [...found];
  });

  $effect(() => {
    const wanted = records;
    let current = true;
    sleeves = [];
    void Promise.all(wanted.map((album) => covers.url(album, 256))).then((urls) => {
      if (current) sleeves = urls.filter((url) => url !== null);
    });
    return () => {
      current = false;
    };
  });

  const mosaic = $derived(sleeves.length >= MOSAIC ? sleeves.slice(0, MOSAIC) : sleeves.slice(0, 1));
</script>

<span class="cover">
  {#if chosen}
    <img src={chosen} alt="" />
  {:else if mosaic.length}
    <span class="mosaic" class:four={mosaic.length === MOSAIC}>{#each mosaic as sleeve}<img src={sleeve} alt="" loading="lazy" />{/each}</span>
  {:else}
    <i class="icon">{glyph}</i>
  {/if}
</span>

<style>
  .cover {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: inherit;
    background: rgb(0 0 0 / 0.13);
    color: rgb(255 255 255 / 0.23);
    font-size: 34px;
  }

  .cover::after {
    position: absolute;
    inset: 0;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: inherit;
    content: '';
    pointer-events: none;
  }

  .mosaic {
    display: grid;
    width: 100%;
    height: 100%;
  }

  .mosaic.four {
    grid-template-columns: 1fr 1fr;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
