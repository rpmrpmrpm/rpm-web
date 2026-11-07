<script lang="ts">
  // The deck along the foot of the window.
  import { player, tuner } from '../../app';
  import { icons } from '../../design/icons';
  import { now, onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Heart from '../library/Heart.svelte';
  import AppMenu from '../shell/AppMenu.svelte';
  import QueueCard from './QueueCard.svelte';

  let { paneOpen, atHome, onPane, onHome, onSettings, onFeedback, onAbout }: {
    paneOpen: boolean;
    atHome: boolean;
    onPane: () => void;
    onHome: () => void;
    onSettings: () => void;
    onFeedback: () => void;
    onAbout: () => void;
  } = $props();

  const canSetVolume = player.volumeWorks;

  // The keys drive whichever is playing.
  const keys = $derived(onAir.station ? tuner : player);
  const playing = $derived(onAir.station ? onAir.wantsToPlay : now.wantsToPlay);
  let queueOpen = $state(false);
  let menuOpen = $state(false);
</script>

<footer class="pane deck">
  <div class="side">
    <button class="glass-button pill pane-pill" class:open={paneOpen} title={text('Deck_PaneTip')} aria-label={text('Deck_PaneTip')} aria-pressed={paneOpen} onclick={onPane}>
      <span class="frame"><span class="drawer"></span></span>
    </button>
    <button class="glass-button pill" class:on={atHome} title={text('Deck_HomeTip')} aria-label={text('Deck_HomeTip')} aria-pressed={atHome} onclick={onHome}><i class="icon">{icons.home}</i></button>
    {#if now.trouble}
      <span class="trouble" role="status"><i class="icon">{icons.warning}</i>{text(now.trouble)}</span>
    {/if}
  </div>

  <div class="transport">
    {#if now.track}<Heart track={now.track} />{/if}
    <button class="key" title={text('Deck_QueueTip')} aria-label={text('Deck_QueueTip')} onclick={() => (queueOpen = !queueOpen)}><i class="icon">{icons.queue}</i></button>
    <button class="key" title={text('Transport_Stop')} onclick={() => keys.stop()}><i class="icon">{icons.stop}</i></button>
    <button class="key" title={text('Transport_Previous')} onclick={() => keys.previous()}><i class="icon big">{icons.previous}</i></button>
    <button class="key play" title={text('Transport_PlayPause')} onclick={() => keys.toggle()}>
      <i class="icon">{playing ? icons.pause : icons.play}</i>
    </button>
    <button class="key" title={text('Transport_Next')} onclick={() => keys.next()}><i class="icon big">{icons.next}</i></button>

    {#if canSetVolume}
      <span class="rule"></span>
      <i class="icon mark">{icons.volume}</i>
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
    <button class="glass-button pill" title={text('Deck_MenuTip')} aria-label={text('Deck_MenuTip')} onclick={() => (menuOpen = !menuOpen)}><i class="icon">{icons.menu}</i></button>
  </div>

  {#if queueOpen}
    <QueueCard onClose={() => (queueOpen = false)} />
  {/if}

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
    align-items: center;
    padding: 10px 16px;
    overflow: visible;
  }

  .transport {
    display: flex;
    gap: 6px;
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

  /* The pill plays the move the pane makes: a drawer in a little window, sliding out of its left edge. */
  .frame {
    display: block;
    width: 26px;
    height: 16px;
    overflow: hidden;
    box-sizing: border-box;
    border: 1px solid rgb(255 255 255 / 0.4);
    border-radius: 4px;
    background: rgb(255 255 255 / 0.07);
  }

  .drawer {
    display: block;
    width: 10px;
    height: 100%;
    border-radius: 3px 0 0 3px;
    background: linear-gradient(rgb(255 255 255 / 0.65), rgb(255 255 255 / 0.35));
    transform: translateX(-7px);
    transition: transform 240ms var(--move);
  }

  .pane-pill:hover .drawer {
    transform: translateX(-4px);
  }

  .pane-pill.open .drawer {
    transform: none;
  }

  .pill.on {
    --face: rgb(3 113 208 / 0.45);
  }

  .key.play .icon {
    font-size: 26px;
    color: #fff;
  }

  .key .big {
    font-size: 16px;
  }

  .key.small {
    min-width: 26px;
  }

  .rule {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--hairline);
  }

  .mark {
    margin: 0 2px;
    color: var(--text-soft);
    font-size: 13px;
  }

  .volume {
    width: 92px;
  }

  .readout {
    width: 34px;
    color: var(--text-soft);
    font-size: 11px;
    text-align: right;
  }

  .pill {
    width: 46px;
    min-width: 0;
    height: 38px;
    padding: 0;
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
