<script lang="ts">
  // One shelf on the genre wall: its colour, a picture of one of its acts or its own photograph, and its
  // name in its own lettering. The picture is asked for when the card comes into view.
  import { artistArt } from '../../app';
  import { photoAddress, type GenreArt } from '../../library/genre-art';
  import { albumCount } from '../../strings/counts';
  import { seen } from './seen';
  import GenreMark from './GenreMark.svelte';

  let { name, act, albums, art, onOpen }: { name: string; act: string | null; albums: number; art: GenreArt | undefined; onOpen: () => void } = $props();

  let picture = $state<string | null>(null);

  // What is known already is drawn at once. A wall opened again does not wait for each card to come into view
  // and ask again. While the act's photograph is not known, the card waits for it rather than show the
  // shelf's own photograph and change it a moment later.
  $effect(() => {
    const photo = act ? artistArt.knownPhoto(act) : null;
    if (photo !== undefined) picture = photo ?? (art ? photoAddress(art) : null);
  });

  async function arrive() {
    const photo = act ? await artistArt.photo(act) : null;
    picture = photo ?? (art ? photoAddress(art) : null);
  }

  const height = $derived(art ? Math.min(28, 72 / art.aspect / 1.3) : 28);
</script>

<button class="card" style:--colour={art?.colour ?? '#30343c'} class:frost={art?.finish === 'frost'} title={albumCount(albums)} use:seen={arrive} onclick={onOpen}>
  {#if picture}<img src={picture} alt="" />{/if}
  <span class="across"></span>
  <span class="down"></span>
  <span class="name" style:height="{height}%" style:aspect-ratio={art?.aspect ?? 'auto'}><GenreMark {art} {name} /></span>
</button>

<style>
  .card {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1.3;
    padding: 0;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.2);
    border-radius: 10px;
    background: linear-gradient(135deg, var(--colour), color-mix(in srgb, var(--colour) 55%, #000));
    color: inherit;
    cursor: pointer;
  }

  .card:hover {
    border-color: rgb(255 255 255 / 0.67);
  }

  img {
    position: absolute;
    top: 0;
    right: 0;
    width: 85%;
    height: 100%;
    object-fit: cover;
  }

  .frost img {
    opacity: 0.75;
    filter: saturate(0.85);
  }

  .across,
  .down {
    position: absolute;
    inset: 0;
  }

  .across {
    background: linear-gradient(90deg, var(--colour) 15%, color-mix(in srgb, var(--colour) 65%, transparent) 40%, transparent 72%);
  }

  .frost .across {
    background: linear-gradient(90deg, var(--colour) 15%, color-mix(in srgb, var(--colour) 72%, transparent) 50%, color-mix(in srgb, var(--colour) 30%, transparent));
  }

  .down {
    background: linear-gradient(transparent 45%, rgb(0 0 0 / 0.3));
  }

  .name {
    position: absolute;
    top: 50%;
    left: 6%;
    max-width: 72%;
    transform: translateY(-50%);
  }
</style>
