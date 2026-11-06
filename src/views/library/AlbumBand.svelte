<script lang="ts">
  // The drawer that opens under a record on the wall, in the colour of its cover.
  import type { CloudAlbum } from '../../library/albums';
  import { bandGradient, colourOf } from '../../library/colour';
  import AlbumDetail from './AlbumDetail.svelte';

  let { album }: { album: CloudAlbum } = $props();

  let background = $state('rgb(255 255 255 / 0.08)');

  async function sleeve(url: string) {
    const colour = await colourOf(url);
    if (colour) background = bandGradient(colour);
  }
</script>

<div class="band" style:background>
  <AlbumDetail {album} onSleeve={sleeve} />
</div>

<style>
  .band {
    padding: 18px 20px;
    border: 1px solid rgb(255 255 255 / 0.13);
    border-radius: 8px;
  }
</style>
