<script lang="ts">
  // A genre's name in its own lettering. A name the table does not know is set in the app's face.
  import { viewBoxOf, type GenreArt } from '../../library/genre-art';

  let { art, name }: { art: GenreArt | undefined; name: string } = $props();
</script>

{#if art}
  <svg viewBox={viewBoxOf(art)} role="img" aria-label={name}><path d={art.path} /></svg>
{:else}
  <span>{name}</span>
{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: #fff;
    overflow: visible;
  }

  span {
    color: #fff;
    font-size: 24px;
    font-weight: 700;
  }
</style>
