<script lang="ts">
  // The bar above the tabs on a phone. Pressing it opens the player.
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { onOpen }: { onOpen: () => void } = $props();

  const fraction = $derived(now.duration > 0 ? Math.min(now.seconds / now.duration, 1) : 0);
</script>

<div class="mini">
  <button class="open" onclick={onOpen}>
    <span class="title">{now.track?.title}</span>
    <span class="artist">{now.track?.artist}</span>
  </button>
  <button class="key" title={text('Transport_PlayPause')} onclick={() => player.toggle()}>
    <i class="icon">{now.wantsToPlay ? icons.pause : icons.play}</i>
  </button>
  <button class="key" title={text('Transport_Next')} onclick={() => player.next()}><i class="icon">{icons.next}</i></button>
  <div class="progress" style:width="{fraction * 100}%"></div>
</div>

<style>
  .mini {
    position: relative;
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
