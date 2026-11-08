<script lang="ts">
  // The picture a list wears: the one chosen for it, or four of its records, or the sleeve of the only one. A
  // generated list also wears its frame over the picture, lettered with its name. See list-frame.ts.
  import type { CloudTrack } from '../../api/wire';
  import { covers, playlists } from '../../app';
  import { icons } from '../../design/icons';
  import type { CloudAlbum } from '../../library/albums';
  import { frameFor, knownFrame } from '../../library/list-frame';
  import type { ListLook } from '../../library/list-look';
  import { library } from '../../state.svelte';

  let {
    id = null,
    tracks,
    glyph = icons.playlist,
    version = 0,
    framed = null,
  }: { id?: string | null; tracks: readonly CloudTrack[]; glyph?: string; version?: number; framed?: { name: string; look: ListLook } | null } = $props();

  const MOSAIC = 4;

  let chosen = $state<string | null>(null);
  let sleeves = $state.raw<string[]>([]);
  let frame = $state<string | null>(null);

  $effect(() => {
    const wanted = framed;
    let current = true;
    frame = wanted ? knownFrame(wanted.name, wanted.look) : null;
    if (wanted && !frame) {
      void frameFor(wanted.name, wanted.look).then((address) => {
        if (current) frame = address;
      });
    }
    return () => {
      current = false;
    };
  });

  // The five lists with no picture of their own show their colours behind the window, where the desktop draws its
  // room. Only once the frame is here: a room with no frame round it would be a plain square of colour.
  const room = $derived.by(() => {
    if (!framed?.look.roomed || !frame) return null;
    const [hot, mid, deep] = [framed.look.trio.hot, framed.look.trio.mid, framed.look.trio.deep].map((colour) => `rgb(${colour.join(' ')})`);
    return `radial-gradient(circle at 30% 25%, ${hot} 0%, ${mid} 45%, ${deep} 100%)`;
  });

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
  {#if room}
    <span class="room" style:background={room}></span>
  {:else if chosen}
    <img src={chosen} alt="" />
  {:else if mosaic.length}
    <span class="mosaic" class:four={mosaic.length === MOSAIC}>{#each mosaic as sleeve}<img src={sleeve} alt="" loading="lazy" />{/each}</span>
  {:else}
    <i class="icon">{glyph}</i>
  {/if}
  {#if frame}<img class="frame" src={frame} alt="" />{/if}
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

  .room {
    width: 100%;
    height: 100%;
  }

  .frame {
    position: absolute;
    inset: 0;
  }
</style>
