<script lang="ts">
  // The window. Three shells over one set of views, chosen by the width available: the desktop's panes,
  // one pane at a time, and the phone apps' tabs.
  import '../../state.svelte';
  import { library, now } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import { icons } from '../../design/icons';
  import Deck from '../deck/Deck.svelte';
  import MiniPlayer from '../deck/MiniPlayer.svelte';
  import NowPlaying from '../deck/NowPlaying.svelte';
  import ImportPane from '../import/ImportPane.svelte';
  import Profile from '../profile/Profile.svelte';
  import Library, { type LibraryMode } from '../library/Library.svelte';
  import DesktopOffer from './DesktopOffer.svelte';
  import Header from './Header.svelte';
  import Mark from './Mark.svelte';
  import Room from './Room.svelte';

  type Left = 'info' | 'import' | 'account' | 'feedback' | null;

  let width = $state(innerWidth);
  let left = $state<Left>(null);
  let tab = $state<'home' | 'library' | 'import' | 'profile'>('home');
  let mode = $state<LibraryMode>('home');

  const RIGHT: [LibraryMode, string, string][] = [
    ['home', icons.home, 'Rpm_Tab_Home'],
    ['albums', icons.album, 'RightNav_Albums'],
    ['artists', icons.artist, 'RightNav_Artists'],
    ['genres', icons.genre, 'RightNav_Genres'],
    ['playlists', icons.playlist, 'Playlists_Title'],
  ];
  let playerOpen = $state(false);

  const layout = $derived(width >= 1100 ? 'wide' : width >= 700 ? 'medium' : 'narrow');

  const pickLeft = (view: Left) => (left = left === view ? null : view);

  // A first run on an empty library starts at Import, which is what there is to do.
  let started = false;
  $effect(() => {
    if (started || library.state !== 'ready') return;
    started = true;
    if (library.albums.length === 0) {
      left = 'import';
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
        <Library compact mode={mode === 'home' ? 'albums' : mode} picker onPick={(picked) => (mode = picked)} onImport={() => (tab = 'import')} />
      {:else if tab === 'import'}
        <ImportPane />
      {:else}
        <Profile />
      {/if}
    </main>

    {#if now.track}
      <MiniPlayer onOpen={() => (playerOpen = true)} />
    {/if}

    <nav class="tabs">
      <button class:on={tab === 'home'} onclick={() => (tab = 'home')}>
        <i class="icon">{icons.home}</i>{text('Rpm_Tab_Home')}
      </button>
      <button class:on={tab === 'library'} onclick={() => (tab = 'library')}>
        <i class="icon">{icons.album}</i>{text('RightNav_Albums')}
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
          <button class:on={left === 'import'} onclick={() => pickLeft('import')}>
            <i class="icon">{icons.import}</i>{text('Queue_Title')}
          </button>
        </nav>
        {#if left === 'import'}
          <div class="view"><ImportPane /></div>
        {:else if left === 'account' || left === 'feedback'}
          {#key left}
            <div class="view"><Profile startOn={left} /></div>
          {/key}
        {/if}
      </section>

      {#if layout === 'wide' || left === null}
        <section class="pane right">
          <div class="view"><Library {mode} onImport={() => (left = 'import')} /></div>
          <nav class="rail">
            {#each RIGHT as [id, icon, label]}
              <button class:on={mode === id} onclick={() => (mode = id)}><i class="icon">{icon}</i>{text(label)}</button>
            {/each}
          </nav>
        </section>
      {/if}
    </div>

    <Deck onAccount={() => (left = 'account')} onFeedback={() => (left = 'feedback')} />
  </div>
{/if}

<style>
  .window {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 16px;
    height: 100dvh;
    padding: 0 24px 16px;
  }

  .panes {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 18px;
    min-height: 0;
  }

  .panes.leftOpen {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  }

  .pane {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .view {
    flex: 1;
    min-width: 0;
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
    background: rgb(255 255 255 / 0.12);
    color: #fff;
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
