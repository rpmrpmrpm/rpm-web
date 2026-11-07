<script lang="ts">
  // The top right of the window on a computer: open the desktop app if it is here, or download it.
  import { canOpen, desktopPlatform, DesktopApp, OPEN_ADDRESS } from '../../desktop/desktop-app';
  import { text } from '../../strings/loc';
  import DesktopGet from './DesktopGet.svelte';

  const platform = desktopPlatform(navigator);
  const app = new DesktopApp();
  const openable = canOpen(platform);
  // Firefox replaces the page with an error for an address it has no app for, which would stop the music.
  const openTarget = /Firefox/.test(navigator.userAgent) ? '_blank' : undefined;

  let here = $state(openable && app.here);
  let note = $state('');

  async function opened() {
    note = '';
    const came = await app.watch(() => {
      here = true;
      note = '';
    });
    here = came;
    if (!came) note = text('Web_DesktopDidNotOpen');
  }
</script>

{#if platform}
  <aside>
    <p class:trouble={note}>{note || text(here ? 'Web_DesktopHere' : 'Web_DesktopPitch')}</p>
    {#if openable}
      <a class={here ? 'glass-button primary' : 'link'} href={OPEN_ADDRESS} target={openTarget} onclick={opened}>{text('Web_DesktopOpen')}</a>
    {/if}
    {#if !here}
      <DesktopGet onTrouble={(trouble) => (note = trouble)} />
    {/if}
  </aside>
{/if}

<style>
  aside {
    position: absolute;
    z-index: 3;
    top: 16px;
    right: 24px;
    display: flex;
    gap: 14px;
    align-items: center;
  }

  p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  p.trouble {
    color: var(--text);
  }

  @media (max-width: 1099px) {
    p:not(.trouble) {
      display: none;
    }
  }

  a.glass-button {
    display: inline-flex;
    align-items: center;
    color: inherit;
    text-decoration: none;
  }

  .glass-button {
    padding: 7px 14px;
    font-size: 13px;
  }

</style>
