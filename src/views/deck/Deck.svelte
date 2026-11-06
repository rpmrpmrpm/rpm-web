<script lang="ts">
  // The deck along the foot of the window.
  import { player, session } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import QueueCard from './QueueCard.svelte';

  const canSetVolume = player.volumeWorks;
  let queueOpen = $state(false);
  let menuOpen = $state(false);
</script>

<footer class="pane deck">
  <div class="side">
    {#if now.trouble}
      <span class="trouble" role="status"><i class="icon">{icons.warning}</i>{text(now.trouble)}</span>
    {/if}
  </div>

  <div class="transport">
    <button class="key" title={text('Transport_Stop')} onclick={() => player.stop()}><i class="icon">{icons.stop}</i></button>
    <button class="key" title={text('Transport_Previous')} onclick={() => player.previous()}><i class="icon big">{icons.previous}</i></button>
    <button class="key play" title={text('Transport_PlayPause')} onclick={() => player.toggle()}>
      <i class="icon">{now.wantsToPlay ? icons.pause : icons.play}</i>
    </button>
    <button class="key" title={text('Transport_Next')} onclick={() => player.next()}><i class="icon big">{icons.next}</i></button>

    {#if canSetVolume}
      <span class="rule"></span>
      <i class="icon mark">{icons.volume}</i>
      <button class="key small" title={text('Transport_VolumeDown')} onclick={() => player.setVolume(now.volume - 0.05)}><i class="icon">{icons.minus}</i></button>
      <input
        class="volume"
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
    <button class="glass-button pill" title={text('Deck_QueueTip')} onclick={() => (queueOpen = !queueOpen)}><i class="icon">{icons.queue}</i></button>
    <button class="glass-button pill" title={text('Deck_MenuTip')} onclick={() => (menuOpen = !menuOpen)}><i class="icon">{icons.menu}</i></button>
  </div>

  {#if queueOpen}
    <QueueCard onClose={() => (queueOpen = false)} />
  {/if}

  {#if menuOpen}
    <div class="menu pane">
      <button onclick={() => session.signOut()}>{text('Login_SignOut')}</button>
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
    accent-color: #fff;
  }

  .readout {
    width: 34px;
    color: var(--text-soft);
    font-size: 11px;
    text-align: right;
  }

  .pill {
    width: 50px;
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

  .menu button {
    padding: 10px 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  @media (hover: hover) {
    .menu button:hover {
      background: rgb(255 255 255 / 0.1);
    }
  }
</style>
