<script lang="ts">
  // Home: the rows there is data for. A new account starts with Recently added.
  import { playLog } from '../../app';
  import { homeAlbums, homeRows, type HomeRowKind } from '../../library/home';
  import { albumsByKey } from '../../library/walls';
  import type { CloudAlbum } from '../../library/albums';
  import { library } from '../../state.svelte';
  import { text } from '../../strings/loc';
  import Shelf from './Shelf.svelte';

  let { onOpen, onImport }: { onOpen: (album: CloudAlbum) => void; onImport: () => void } = $props();

  const TITLES: Record<HomeRowKind, string> = {
    listened: 'Home_Listened',
    suggested: 'Home_Suggested',
    taste: 'Home_Taste',
    played: 'Home_Played',
    added: 'Home_Added',
  };

  // One draw a day, so the rows hold still within a day and move between days.
  const draw = Math.floor(Date.now() / 86_400_000);

  const rows = $derived.by(() => {
    void library.playsVersion;
    const held = albumsByKey(library.albums);
    return homeRows(homeAlbums(library.albums, playLog.everythingPlayed()), draw).map((row) => ({
      kind: row.kind,
      albums: row.keys.flatMap((key) => held.get(key) ?? []),
    }));
  });
</script>

<div class="home">
  <h2 class="heading">{text('Home_Heading')}</h2>
  {#each rows as row (row.kind)}
    <Shelf title={text(TITLES[row.kind])} albums={row.albums} {onOpen} />
  {:else}
    {#if library.state === 'ready'}
      <div class="message">
        <p>{text('Web_LibraryEmpty')}</p>
        <button class="glass-button primary" onclick={onImport}>{text('Queue_Title')}</button>
      </div>
    {/if}
  {/each}
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    padding: 14px 16px;
    overflow-y: auto;
  }

  .message {
    color: var(--text-soft);
  }
</style>
