<script lang="ts">
  // The window. Three shells over one set of views, chosen by the width available: the desktop's panes,
  // one pane at a time, and the phone apps' tabs.
  import '../../state.svelte';
  import { library, now, onAir } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { icons } from '../../design/icons';
  import Deck from '../deck/Deck.svelte';
  import MiniPlayer from '../deck/MiniPlayer.svelte';
  import NowPlaying from '../deck/NowPlaying.svelte';
  import ImportPane from '../import/ImportPane.svelte';
  import Window from '../import/Window.svelte';
  import FeedbackWindow from '../profile/FeedbackWindow.svelte';
  import Settings from '../profile/Settings.svelte';
  import Library, { type LibraryMode } from '../library/Library.svelte';
  import TrackInfo from '../library/TrackInfo.svelte';
  import RadioPane from '../radio/RadioPane.svelte';
  import AboutWindow from './AboutWindow.svelte';
  import AppMenu from './AppMenu.svelte';
  import DesktopOffer from './DesktopOffer.svelte';
  import Header from './Header.svelte';
  import Mark from './Mark.svelte';
  import Room from './Room.svelte';

  type Left = 'info' | 'radio' | 'import' | null;

  // The desktop's gesture: the content fades out, the width moves, and the content fades in.
  const FADE_MS = 110;
  const GLIDE_MS = 240;

  let width = $state(innerWidth);
  let tab = $state<'home' | 'library' | 'radio' | 'import' | 'profile'>('home');

  // left is where the pane is going. drawer is what stands in it: it stays until the pane has closed.
  let left = $state<Left>(null);
  let drawer = $state<Left>(null);
  let drawerClear = $state(false);
  let lastLeft: Exclude<Left, null> = 'info';
  let moving: ReturnType<typeof setTimeout> | undefined;

  // mode is what was asked for. shownMode changes when the old view has faded.
  let mode = $state<LibraryMode>('home');
  let shownMode = $state<LibraryMode>('home');
  let modeClear = $state(true);
  let swapping: ReturnType<typeof setTimeout> | undefined;

  let settingsOpen = $state(false);
  let feedbackOpen = $state(false);
  let aboutOpen = $state(false);

  // Home is not on the rail: it asks the records a different question. Its key is on the deck.
  const RIGHT: [LibraryMode, string, string][] = [
    ['albums', icons.album, 'RightNav_Albums'],
    ['artists', icons.artist, 'RightNav_Artists'],
    ['genres', icons.genre, 'RightNav_Genres'],
    ['playlists', icons.playlist, 'Playlists_Title'],
  ];
  let playerOpen = $state(false);

  const layout = $derived(width >= 1100 ? 'wide' : width >= 700 ? 'medium' : 'narrow');

  function moveLeft(next: Left) {
    clearTimeout(moving);
    if (next) {
      lastLeft = next;
      drawer = next;
    }
    left = next;
    drawerClear = false;
    moving = setTimeout(() => {
      drawer = next;
      drawerClear = next !== null;
    }, FADE_MS + GLIDE_MS);
  }

  const pickLeft = (view: Left) => moveLeft(left === view ? null : view);

  function pickMode(next: LibraryMode) {
    if (next === mode) return;
    clearTimeout(swapping);
    mode = next;
    modeClear = false;
    swapping = setTimeout(() => {
      shownMode = next;
      modeClear = true;
    }, FADE_MS);
  }

  // A first run on an empty library starts at Import, which is what there is to do.
  let started = false;
  $effect(() => {
    if (started || library.state !== 'ready') return;
    started = true;
    if (library.albums.length === 0) {
      moveLeft('import');
      tab = 'import';
    }
  });
</script>

<svelte:window bind:innerWidth={width} />

<Room />

{#if layout === 'narrow'}
  <div class="narrow">
    <header class="top"><Mark size={1.33} /></header>

    <main>
      {#if tab === 'home'}
        <Library compact mode="home" onImport={() => (tab = 'import')} />
      {:else if tab === 'library'}
        <Library compact mode={mode === 'home' ? 'albums' : mode} picker onPick={pickMode} onImport={() => (tab = 'import')} />
      {:else if tab === 'radio'}
        <RadioPane />
      {:else if tab === 'import'}
        <ImportPane />
      {:else}
        <div class="account">
          <Settings />
          <AppMenu onFeedback={() => (feedbackOpen = true)} onAbout={() => (aboutOpen = true)} />
        </div>
      {/if}
    </main>

    {#if now.track || onAir.station}
      <MiniPlayer onOpen={() => (onAir.station ? (tab = 'radio') : (playerOpen = true))} />
    {/if}

    <nav class="tabs">
      <button class:on={tab === 'home'} onclick={() => (tab = 'home')}>
        <i class="icon">{icons.home}</i>{text('Rpm_Tab_Home')}
      </button>
      <button class:on={tab === 'library'} onclick={() => (tab = 'library')}>
        <i class="icon">{icons.album}</i>{text('RightNav_Albums')}
      </button>
      <button class:on={tab === 'radio'} onclick={() => (tab = 'radio')}>
        <i class="icon">{icons.radio}</i>{text('Rpm_Tab_Radio')}
      </button>
      <button class:on={tab === 'import'} onclick={() => (tab = 'import')}>
        <i class="icon">{icons.import}</i>{text('Queue_Title')}
      </button>
      <button class:on={tab === 'profile'} onclick={() => (tab = 'profile')}>
        <i class="icon">{icons.artist}</i>{text('Rpm_Profile_Account')}
      </button>
    </nav>

    {#if playerOpen}
      <NowPlaying onClose={() => (playerOpen = false)} />
    {/if}
  </div>
{:else}
  <div class="window">
    <Header />
    <DesktopOffer />

    <div class="panes" class:leftOpen={left !== null}>
      <section class="pane left">
        <nav class="rail">
          <button class:on={left === 'info'} onclick={() => pickLeft('info')}>
            <i class="icon">{icons.info}</i>{text('LeftNav_TrackInfo')}
          </button>
          <button class:on={left === 'radio'} onclick={() => pickLeft('radio')}>
            <i class="icon">{icons.radio}</i>{text('LeftNav_Radio')}
          </button>
          <button class:on={left === 'import'} onclick={() => pickLeft('import')}>
            <i class="icon">{icons.import}</i>{text('Queue_Title')}
          </button>
          <button class="fold" class:open={left !== null} title={text('Playlists_Close')} aria-label={text('Playlists_Close')} onclick={() => moveLeft(left ? null : lastLeft)}>
            <i class="icon">{icons.back}</i>
          </button>
        </nav>
        {#if drawer === 'info'}
          <div class="view" class:clear={drawerClear}><TrackInfo /></div>
        {:else if drawer === 'radio'}
          <div class="view" class:clear={drawerClear}><RadioPane /></div>
        {:else if drawer === 'import'}
          <div class="view" class:clear={drawerClear}><ImportPane /></div>
        {/if}
      </section>

      {#if layout === 'wide' || left === null}
        <section class="pane right">
          <div class="view" class:clear={modeClear}><Library mode={shownMode} onPick={pickMode} onImport={() => moveLeft('import')} /></div>
          <nav class="rail">
            {#each RIGHT as [id, icon, label]}
              <button class:on={mode === id} onclick={() => pickMode(id)}><i class="icon">{icon}</i>{text(label)}</button>
            {/each}
          </nav>
        </section>
      {/if}
    </div>

    <Deck
      paneOpen={left !== null}
      atHome={mode === 'home'}
      onPane={() => moveLeft(left ? null : lastLeft)}
      onHome={() => pickMode('home')}
      onSettings={() => (settingsOpen = true)}
      onFeedback={() => (feedbackOpen = true)}
      onAbout={() => (aboutOpen = true)}
    />
  </div>
{/if}

{#if settingsOpen}
  <Window title={text('Settings_Title')} glyph={icons.settings} minWidth={760} maxWidth={1280} openWidth={1000} minHeight={520} openHeight={660} onClose={() => (settingsOpen = false)}>
    <Settings />
    {#snippet footer()}
      <button class="glass-button" onclick={() => (settingsOpen = false)}><i class="icon">{icons.close}</i>{text('Settings_Close')}</button>
    {/snippet}
  </Window>
{/if}
{#if feedbackOpen}
  <FeedbackWindow onClose={() => (feedbackOpen = false)} />
{/if}
{#if aboutOpen}
  <AboutWindow onClose={() => (aboutOpen = false)} />
{/if}

<style>
  .window {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    height: 100dvh;
    padding: 0 24px 16px;
  }

  .panes {
    display: flex;
    gap: 18px;
    min-height: 0;
  }

  .pane {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* The column moves after the content has faded, and the rail stays where it is. */
  .pane.left {
    flex: 0 0 92px;
    transition: flex-basis 240ms var(--move) 110ms;
  }

  .panes.leftOpen .pane.left {
    flex-basis: 41.6%;
  }

  .pane.right {
    flex: 1;
  }

  .view {
    flex: 1;
    min-width: 0;
    opacity: 0;
    transition: opacity 110ms linear;
  }

  .view.clear {
    opacity: 1;
  }

  .account {
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    padding: 14px 16px;
    overflow-y: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .pane.left,
    .view {
      transition: none;
    }
  }

  .rail {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 92px;
  }

  .rail button {
    display: grid;
    align-content: center;
    gap: 7px;
    justify-items: center;
    height: 80px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-soft);
    font-size: 11.5px;
    cursor: pointer;
  }

  .rail button .icon {
    font-size: 16px;
  }

  .rail button.on {
    background: rgb(3 113 208 / 0.22);
    color: #fff;
  }

  /* Closes the pane. The chevron turns to say which way it will go. */
  .rail .fold {
    align-self: center;
    width: 34px;
    height: 30px;
    margin: auto 0 8px;
    color: rgb(255 255 255 / 0.67);
  }

  .fold .icon {
    font-size: 12px;
    transform: rotate(180deg);
    transition: transform 240ms var(--move);
  }

  .fold.open .icon {
    transform: none;
  }

  .narrow {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    height: 100dvh;
  }

  .top {
    padding: max(8px, env(safe-area-inset-top)) 16px 6px;
  }

  .narrow main {
    min-height: 0;
  }

  .tabs {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid var(--hairline);
    background: rgb(0 0 0 / 0.35);
    backdrop-filter: blur(30px);
  }

  .tabs button {
    display: grid;
    align-content: center;
    gap: 5px;
    justify-items: center;
    height: 56px;
    padding: 8px 0 6px;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 11px;
  }

  .tabs button.on {
    color: #fff;
  }

  .tabs .icon {
    font-size: 18px;
  }
</style>
