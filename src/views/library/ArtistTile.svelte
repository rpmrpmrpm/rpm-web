<script lang="ts">
  // One act on the artist wall: their photograph under their own colour, with the name across it. An act with
  // no photograph is a finished tile in the colour of their first record.
  import { artistArt, covers } from '../../app';
  import type { CloudAlbum } from '../../library/albums';
  import { colourOf, css, knownColour, type Colour } from '../../library/colour';
  import { seen } from './seen';

  let { name, album, onOpen }: { name: string; album: CloudAlbum | undefined; onOpen: () => void } = $props();

  let picture = $state<string | null>(null);
  let colour = $state<Colour | null>(null);

  // What is known already is drawn at once. A wall opened again does not wait for each tile to come into view
  // and ask again. The tile still asks when it comes into view, and takes the answer.
  $effect(() => {
    const photo = artistArt.knownPhoto(name);
    const sleeve = photo === null && album ? covers.known(album, 256) : null;
    const known = photo ?? sleeve;
    picture = photo ?? null;
    colour = (known && knownColour(known)) || null;
  });

  async function arrive() {
    const photo = await artistArt.photo(name);
    if (photo) {
      picture = photo;
      colour = await colourOf(photo);
      return;
    }
    const sleeve = album ? await covers.url(album, 256) : null;
    if (sleeve) colour = await colourOf(sleeve);
  }
</script>

<button class="tile" class:bare={!picture} style:--colour={colour ? css(colour) : 'rgb(255 255 255 / 0.1)'} use:seen={arrive} onclick={onOpen}>
  {#if picture}<img src={picture} alt="" />{/if}
  <span class="wash"></span>
  <span class="ink"></span>
  <strong>{name}</strong>
</button>

<style>
  .tile {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1.78;
    padding: 0 8%;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 10px;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font: inherit;
    cursor: pointer;
  }

  .tile:hover {
    border-color: rgb(255 255 255 / 0.67);
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .wash,
  .ink {
    position: absolute;
    inset: 0;
  }

  .wash {
    background: linear-gradient(color-mix(in srgb, var(--colour) 22%, transparent), color-mix(in srgb, var(--colour) 45%, transparent));
  }

  .bare .wash {
    background: linear-gradient(color-mix(in srgb, var(--colour) 70%, transparent), color-mix(in srgb, var(--colour) 30%, #000 35%));
  }

  .ink {
    background: rgb(0 0 0 / 0.18);
  }

  strong {
    position: relative;
    display: -webkit-box;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
