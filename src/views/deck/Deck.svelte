<script lang="ts">
  // The deck along the foot of the window.
  import { player, tuner } from '../../app';
  import { icons } from '../../design/icons';
  import { now, onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Heart from '../library/Heart.svelte';
  import AppMenu from '../shell/AppMenu.svelte';
  import QueueCard from './QueueCard.svelte';

  let { atHome, onHome, onSearch, onSettings, onFeedback, onAbout }: {
    atHome: boolean;
    onHome: () => void;
    // The library search over the window, the same as Cmd+F or Ctrl+F.
    onSearch: () => void;
    onSettings: () => void;
    onFeedback: () => void;
    onAbout: () => void;
  } = $props();

  const canSetVolume = player.volumeWorks;

  // The keys drive whichever is playing.
  const keys = $derived(onAir.station ? tuner : player);
  const playing = $derived(onAir.station ? onAir.wantsToPlay : now.wantsToPlay);
  let queueOpen = $state(false);
  let queueKey = $state<HTMLElement | null>(null);
  let menuOpen = $state(false);
</script>

<footer class="pane deck">
  <div class="side">
    <button class="deck-pill home" class:on={atHome} title={text('Deck_HomeTip')} aria-label={text('Deck_HomeTip')} aria-pressed={atHome} onclick={onHome}><i class="icon">{icons.home}</i></button>
    <button class="deck-pill" title={text('Rpm_Search_Library')} aria-label={text('Rpm_Search_Library')} onclick={onSearch}><i class="icon">{icons.search}</i></button>
    {#if now.trouble}
      <span class="trouble" role="status"><i class="icon">{icons.warning}</i>{text(now.trouble)}</span>
    {/if}
  </div>

  <div class="transport">
    {#if now.track}<Heart track={now.track} />{/if}
    <!-- The Now playing card opens upwards from its key, as the desktop's deck flyouts do. -->
    <span class="anchor" bind:this={queueKey}>
      <button class="key" class:on={queueOpen} title={text('Deck_QueueTip')} aria-label={text('Deck_QueueTip')} aria-expanded={queueOpen} onclick={() => (queueOpen = !queueOpen)}><i class="icon">{icons.queue}</i></button>
      {#if queueOpen}
        <QueueCard anchor={queueKey} onClose={() => (queueOpen = false)} />
      {/if}
    </span>
    <button class="key" title={text('Transport_Stop')} onclick={() => keys.stop()}><i class="icon">{icons.stop}</i></button>
    <button class="key" title={text('Transport_Previous')} onclick={() => keys.previous()}><i class="icon">{icons.previous}</i></button>
    <button class="key play" title={text('Transport_PlayPause')} onclick={() => keys.toggle()}>
      <i class="icon">{playing ? icons.pause : icons.play}</i>
    </button>
    <button class="key" title={text('Transport_Next')} onclick={() => keys.next()}><i class="icon">{icons.next}</i></button>

    {#if canSetVolume}
      <span class="rule"></span>
      <!-- The speaker mark is also the mute, as on the desktop. It takes no focus on a click, so a space bar after it
           still pauses. -->
      <button
        class="mark"
        title={text(now.volume === 0 ? 'Transport_Unmute' : 'Transport_Mute')}
        aria-label={text(now.volume === 0 ? 'Transport_Unmute' : 'Transport_Mute')}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => player.toggleMute()}><i class="icon">{now.volume === 0 ? icons.mute : icons.volume}</i></button
      >
      <button class="key small" title={text('Transport_VolumeDown')} onclick={() => player.setVolume(now.volume - 0.05)}><i class="icon">{icons.minus}</i></button>
      <input
        class="volume slider"
        style:--fill="{now.volume * 100}%"
        type="range"
        min="0"
        max="1"
        step="0.01"
        aria-label={text('Viz_Volume')}
        value={now.volume}
        oninput={(event) => player.setVolume(Number(event.currentTarget.value))}
      />
      <button class="key small" title={text('Transport_VolumeUp')} onclick={() => player.setVolume(now.volume + 0.05)}><i class="icon">{icons.plus}</i></button>
      <span class="readout">{Math.round(now.volume * 100)}%</span>
    {/if}
  </div>

  <div class="side end">
    <button class="deck-pill" title={text('Deck_MenuTip')} aria-label={text('Deck_MenuTip')} onclick={() => (menuOpen = !menuOpen)}><i class="icon">{icons.menu}</i></button>
  </div>

  {#if menuOpen}
    <div class="menu pane">
      <AppMenu {onSettings} {onFeedback} {onAbout} onLeave={() => (menuOpen = false)} />
    </div>
  {/if}
</footer>

<style>
  .deck {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: stretch;
    padding: 12px 16px;
    overflow: visible;
  }

  .transport {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .side {
    display: flex;
    gap: 10px;
    min-width: 0;
  }

  .side.end {
    justify-content: flex-end;
  }

  .deck-pill.on {
    background: var(--selected);
  }

  .key.play .icon {
    font-size: 26px;
    color: #fff;
  }

  .transport .key {
    min-width: 34px;
    height: 34px;
    border-radius: 50%;
    color: rgb(255 255 255 / 0.72);
    font-size: 14px;
  }

  .transport .key.play {
    width: 50px;
    height: 50px;
  }

  /* What the Now playing card stands over. */
  .anchor {
    position: relative;
    display: inline-flex;
  }

  .transport .key.on {
    color: #fff;
  }

  @media (hover: hover) {
    .transport .key:hover {
      background: rgb(255 255 255 / 0.122);
      color: #fff;
    }
  }

  .transport .key.small {
    min-width: 26px;
  }

  .rule {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: rgb(255 255 255 / 0.149);
  }

  .mark {
    width: 16px;
    height: 16px;
    margin: 0 2px;
    padding: 0;
    border: 0;
    background: none;
    color: rgb(255 255 255 / 0.53);
    font-size: 13px;
    text-align: center;
    cursor: pointer;
  }

  .mark:hover {
    color: #fff;
  }

  .volume {
    width: 92px;
  }

  .readout {
    width: 30px;
    color: rgb(255 255 255 / 0.47);
    font-size: 11px;
    text-align: right;
  }

  .trouble {
    display: flex;
    gap: 8px;
    align-items: center;
    overflow: hidden;
    color: var(--error);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu {
    position: absolute;
    right: 16px;
    bottom: calc(100% + 8px);
    display: flex;
    flex-direction: column;
    min-width: 180px;
    padding: 6px;
    background: rgb(20 22 28 / 0.92);
  }

</style>
