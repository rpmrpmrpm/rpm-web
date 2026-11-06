<script lang="ts">
  // The player on a phone, over everything else.
  import { catalogue, covers, player } from '../../app';
  import { icons } from '../../design/icons';
  import { now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import SeekBar from './SeekBar.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let sleeve = $state<string | null>(null);

  $effect(() => {
    const track = now.track;
    if (!track) return;
    const album = catalogue.albums.find((a) => a.tracks.some((t) => t.rpmId === track.rpmId));
    if (!album) return;
    let current = true;
    void covers.url(album, 1024).then((url) => {
      if (current) sleeve = url;
    });
    return () => {
      current = false;
    };
  });
</script>

<section class="player">
  <button class="key close" title={text('Common_Cancel')} onclick={onClose}><i class="icon">{icons.chevronDown}</i></button>

  {#if sleeve}<img src={sleeve} alt="" />{:else}<div class="sleeve"></div>{/if}

  <div class="words">
    <h2>{now.track?.title}</h2>
    <p>{now.track?.artist}</p>
  </div>

  <SeekBar seconds={now.seconds} duration={now.duration} onSeek={(s) => player.seek(s)} />

  <div class="keys">
    <button class="key" title={text('Transport_Shuffle')} class:on={now.shuffled} onclick={() => player.toggleShuffle()}><i class="icon">{icons.shuffle}</i></button>
    <button class="key" title={text('Transport_Previous')} onclick={() => player.previous()}><i class="icon wide">{icons.previous}</i></button>
    <button class="key play" title={text('Transport_PlayPause')} onclick={() => player.toggle()}><i class="icon">{now.wantsToPlay ? icons.pause : icons.play}</i></button>
    <button class="key" title={text('Transport_Next')} onclick={() => player.next()}><i class="icon wide">{icons.next}</i></button>
    <button class="key" title={text('Transport_Repeat')} class:on={now.repeat !== 'off'} onclick={() => player.cycleRepeat()}><i class="icon">{icons.repeat}</i></button>
  </div>
</section>

<style>
  .player {
    position: fixed;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: max(12px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
    background: rgb(8 10 16 / 0.92);
    backdrop-filter: blur(40px);
  }

  .close {
    align-self: flex-start;
    margin-left: -12px;
  }

  img,
  .sleeve {
    width: 100%;
    max-height: 50dvh;
    aspect-ratio: 1;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.08);
    object-fit: cover;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-soft);
  }

  .keys {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .wide {
    font-size: 22px;
  }

  .play .icon {
    font-size: 40px;
    color: #fff;
  }

  .on {
    color: #04c8ff;
  }
</style>
