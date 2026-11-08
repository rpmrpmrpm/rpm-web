<script lang="ts">
  // The top right of the window on a computer: open the desktop app if it is here, or download it. One line of
  // small text, on the line of the tagline under the wordmark and the same size, so it does not compete with the
  // music.
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
      <a href={OPEN_ADDRESS} target={openTarget} onclick={opened}>{text('Web_DesktopOpen')}</a>
    {/if}
    {#if !here}
      <DesktopGet plain onTrouble={(trouble) => (note = trouble)} />
    {/if}
  </aside>
{/if}

<style>
  /* The tagline's line in the header: 25 of padding, the 36 of the wordmark and 1 of gap, then 14 high. Also set
     in Header.svelte, change both. The right edge is the panes' edge. */
  aside {
    position: absolute;
    z-index: 3;
    top: 62px;
    right: 24px;
    display: flex;
    gap: 12px;
    align-items: center;
    height: 14px;
    color: rgb(255 255 255 / 0.65);
    font-size: 11px;
    line-height: 14px;
    white-space: nowrap;
  }

  p {
    margin: 0;
    color: rgb(255 255 255 / 0.4);
  }

  p.trouble {
    color: var(--text);
  }

  @media (max-width: 1099px) {
    p:not(.trouble) {
      display: none;
    }
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  @media (hover: hover) {
    a:hover {
      color: #fff;
      text-decoration: underline;
    }
  }
</style>
