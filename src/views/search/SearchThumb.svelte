<script lang="ts">
  // The 40 picture at the front of a search row: round for a person, square for everything else, so an artist
  // reads apart from the records, playlists and genres around them. The glyph stands until the picture comes, and
  // stays where none does.
  let { load = null, glyph, round = false }: { load?: (() => Promise<string | null>) | null; glyph: string; round?: boolean } = $props();

  let picture = $state<string | null>(null);

  $effect(() => {
    const asking = load;
    let current = true;
    picture = null;
    if (asking)
      void asking().then(
        (url) => {
          if (current) picture = url;
        },
        () => {},
      );
    return () => {
      current = false;
    };
  });
</script>

<span class="thumb" class:round>
  <i class="icon">{glyph}</i>
  {#if picture}<img src={picture} alt="" />{/if}
</span>

<style>
  .thumb {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    overflow: hidden;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.078);
  }

  .thumb.round {
    border-radius: 50%;
  }

  .icon {
    color: rgb(255 255 255 / 0.333);
    font-size: 15px;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
