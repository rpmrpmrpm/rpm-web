<script lang="ts">
  // The bar above the tabs on a phone. Pressing it opens the player.
  import { player, tuner } from '../../app';
  import { icons } from '../../design/icons';
  import { displayOf } from '../../radio/station';
  import { now, onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { onOpen }: { onOpen: () => void } = $props();

  const fraction = $derived(now.duration > 0 ? Math.min(now.seconds / now.duration, 1) : 0);
  const keys = $derived(onAir.station ? tuner : player);
  const playing = $derived(onAir.station ? onAir.wantsToPlay : now.wantsToPlay);
</script>

<div class="mini">
  <button class="open" onclick={onOpen}>
    <span class="title">{onAir.station ? displayOf(onAir.station) : now.track?.title}</span>
    <span class="artist">{onAir.station ? onAir.station.country : now.track?.artist}</span>
  </button>
  <button class="key" title={text('Transport_PlayPause')} onclick={() => keys.toggle()}>
    <i class="icon">{playing ? icons.pause : icons.play}</i>
  </button>
  <button class="key" title={text('Transport_Next')} onclick={() => keys.next()}><i class="icon">{icons.next}</i></button>
  {#if !onAir.station}<div class="progress" style:width="{fraction * 100}%"></div>{/if}
</div>

<style>
  /* Over a record's page, which is where a phone presses Play. */
  .mini {
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    padding: 0 8px 0 0;
    background: rgb(0 0 0 / 0.45);
    backdrop-filter: blur(30px);
  }

  .open {
    display: grid;
    flex: 1;
    min-width: 0;
    padding: 8px 16px;
    border: 0;
    background: none;
    text-align: left;
  }

  .title,
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: 14px;
  }

  .artist {
    color: var(--text-soft);
    font-size: 12px;
  }

  .progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: #fff;
  }
</style>
