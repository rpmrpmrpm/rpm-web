<script lang="ts">
  // The drawer that opens under a record on the wall. It stands on the record's own sleeve: its colour, the sleeve
  // blurred over that, and as much black as the picture needs for white words to read.
  import type { CloudAlbum } from '../../library/albums';
  import { colourOf, veilOver } from '../../library/colour';
  import AlbumDetail from './AlbumDetail.svelte';

  // notch: how far along the drawer the record it opened from stands.
  let { album, notch = 0 }: { album: CloudAlbum; notch?: number } = $props();

  let ground = $state('rgb(255 255 255 / 0.08)');
  let wash = $state<string | null>(null);
  let veil = $state(0);

  async function sleeve(url: string) {
    const colour = await colourOf(url);
    if (!colour) return;
    ground = `rgb(${colour.r} ${colour.g} ${colour.b})`;
    veil = veilOver(colour);
    wash = url;
  }
</script>

<span class="notch" style:left="{notch}px" style:border-bottom-color={ground}></span>
<div class="band" style:background-color={ground}>
  {#if wash}
    <span class="wash" style:background-image="url({wash})"></span>
    <span class="veil" style:opacity={veil}></span>
  {/if}
  <div class="content"><AlbumDetail {album} place="collection" onSleeve={sleeve} /></div>
</div>

<style>
  .notch {
    position: absolute;
    top: -8px;
    width: 0;
    height: 0;
    margin-left: -9px;
    border-right: 9px solid transparent;
    border-bottom: 8px solid;
    border-left: 9px solid transparent;
  }

  .band {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    transition: background-color 240ms var(--move);
  }

  .wash,
  .veil {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .wash {
    inset: -60px;
    background-position: center;
    background-size: cover;
    filter: blur(50px);
    opacity: 0.85;
  }

  .veil {
    background: #000;
  }

  .content {
    position: relative;
    padding: 18px 20px;
  }
</style>
