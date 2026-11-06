<script lang="ts">
  // What is playing and what comes next.
  import { player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';

  let { onClose }: { onClose: () => void } = $props();
</script>

<div class="card pane">
  <header>
    <h3>{text('Viz_BrowseQueue')}</h3>
    <button class="key" class:on={now.shuffled} title={text('Transport_Shuffle')} onclick={() => player.toggleShuffle()}><i class="icon">{icons.shuffle}</i></button>
    <button class="key" class:on={now.repeat !== 'off'} title={text('Transport_Repeat')} onclick={() => player.cycleRepeat()}><i class="icon">{icons.repeat}</i></button>
    <button class="key" title={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.close}</i></button>
  </header>
  <ol>
    {#each now.queue as track, index (index)}
      <li class:playing={index === now.index}>
        <span class="title">{track.title}</span>
        <span class="artist">{track.artist}</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .card {
    position: absolute;
    right: 16px;
    bottom: calc(100% + 8px);
    display: flex;
    flex-direction: column;
    width: min(380px, calc(100vw - 32px));
    max-height: 60dvh;
    background: rgb(20 22 28 / 0.92);
  }

  header {
    display: flex;
    align-items: center;
    padding: 4px 8px 4px 14px;
  }

  h3 {
    flex: 1;
    margin: 0;
    font-size: 14px;
  }

  .on {
    color: #04c8ff;
  }

  ol {
    margin: 0;
    padding: 4px 8px 8px;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: grid;
    padding: 6px 8px;
    border-radius: 6px;
  }

  li.playing {
    background: rgb(255 255 255 / 0.1);
  }

  .title {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artist {
    color: var(--text-faint);
    font-size: 11.5px;
  }
</style>
