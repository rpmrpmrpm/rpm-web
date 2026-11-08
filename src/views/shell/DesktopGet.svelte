<script lang="ts">
  // The download of the desktop app. The button is named for this computer, and goes straight to the
  // file where the browser can tell which one that is.
  import { session } from '../../app';
  import { desktopPlatform, downloadFor, type DownloadTarget } from '../../desktop/desktop-app';
  import { text } from '../../strings/loc';

  // plain: a text link, for a line of small text, rather than a pill button.
  let { onTrouble = () => {}, plain = false }: { onTrouble?: (note: string) => void; plain?: boolean } = $props();

  const platform = desktopPlatform(navigator);
  const name = platform === 'windows' ? text('Web_DesktopWindows') : text('Web_DesktopMac');

  let choosing = $state(false);
  let busy = $state(false);

  async function download(target: DownloadTarget) {
    choosing = false;
    busy = true;
    const address = await session.desktopDownload(target);
    busy = false;
    if (address) location.assign(address);
    else onTrouble(text('Web_DesktopFailed'));
  }

  async function pressed() {
    const target = platform && (await downloadFor(platform, navigator));
    if (target) await download(target);
    else choosing = !choosing;
  }
</script>

{#if platform}
  <div class="download">
    <button class={plain ? 'plain' : 'deck-pill'} disabled={busy} onclick={pressed}>{text('Web_DesktopDownload', name)}</button>
    {#if choosing}
      <div class="menu">
        <button onclick={() => download('mac-arm64')}>{text('Web_DesktopAppleSilicon')}</button>
        <button onclick={() => download('mac-x64')}>{text('Web_DesktopIntel')}</button>
        <button onclick={() => download('mac-x64-macos12')}>{text('Web_DesktopIntelOld')}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .download {
    position: relative;
  }

  .deck-pill {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
  }

  .plain {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  @media (hover: hover) {
    .plain:hover {
      color: #fff;
      text-decoration: underline;
    }
  }

  .menu {
    position: absolute;
    z-index: 4;
    top: calc(100% + 6px);
    right: 0;
    display: grid;
    min-width: 230px;
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: 10px;
    background: var(--ground);
  }

  .menu button {
    padding: 10px 14px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  @media (hover: hover) {
    .menu button:hover {
      background: rgb(255 255 255 / 0.08);
    }
  }
</style>
