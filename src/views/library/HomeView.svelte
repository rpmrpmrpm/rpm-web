<script lang="ts">
  // Home: the rows there is data for. A new account starts with Recently added.
  import { playLog } from '../../app';
  import { homeAlbums, homeRows, type HomeRowKind } from '../../library/home';
  import { chooseQuickPicks, featureStrip } from '../../library/home-features';
  import { albumsByKey } from '../../library/walls';
  import type { CloudAlbum } from '../../library/albums';
  import { library } from '../../state.svelte';
  import { albumCount } from '../../strings/counts';
  import { text } from '../../strings/loc';
  import HomeBanner from './HomeBanner.svelte';
  import QuickSelection, { type QuickEntry } from './QuickSelection.svelte';
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

  const held = $derived(albumsByKey(library.albums));
  const albumOf = (key: string) => held.get(key);

  const rows = $derived.by(() => {
    void library.playsVersion;
    return homeRows(homeAlbums(library.albums, playLog.everythingPlayed()), draw).map((row) => ({
      kind: row.kind,
      keys: row.keys,
      albums: row.keys.flatMap((key) => held.get(key) ?? []),
    }));
  });

  const keysOf = (kind: HomeRowKind) => rows.find((row) => row.kind === kind)?.keys ?? [];

  const cards = $derived(
    featureStrip({
      continued: keysOf('listened').slice(0, 1),
      added: keysOf('added'),
      suggested: keysOf('suggested'),
      played: keysOf('played'),
      listened: keysOf('listened'),
      isVarious: (key) => albumOf(key)?.artist.toLowerCase() === 'various artists',
    }),
  );

  // Songs most played first, and records likewise. Each record is offered once.
  const entries = $derived.by((): QuickEntry[] => {
    void library.playsVersion;
    const plays = playLog.everythingPlayed();
    const songs = new Map(library.albums.flatMap((album) => album.tracks.map((track) => [track.rpmId, { track, album }] as const)));
    const mostPlayed = [...plays.entries()]
      .filter(([id, heard]) => heard.plays > 0 && songs.has(id))
      .sort((a, b) => b[1].plays - a[1].plays)
      .map(([id]) => id);

    const picks = chooseQuickPicks(mostPlayed, keysOf('played'), (pick) => (pick.kind === 'song' ? (songs.get(pick.key)?.album.key ?? null) : pick.key));
    return picks.flatMap((pick) => {
      if (pick.kind === 'song') {
        const song = songs.get(pick.key)!;
        return [{ key: `song-${pick.key}`, title: song.track.title ?? '', line: song.track.artist ?? '', album: song.album, tracks: [song.track] }];
      }
      const album = albumOf(pick.key);
      return album ? [{ key: `album-${pick.key}`, title: album.album, line: text('Home_QuickKindJoin', text('Home_QuickAlbum'), album.artist), album, tracks: album.tracks }] : [];
    });
  });
</script>

<div class="home">
  <header>
    <h2 class="heading">{text('Home_Heading')}</h2>
    <p>{albumCount(library.albums.length)}</p>
  </header>

  <HomeBanner {cards} {albumOf} {onOpen} />
  <QuickSelection {entries} />

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
    gap: 0;
    height: 100%;
    box-sizing: border-box;
    padding: 12px 18px 18px 16px;
    overflow-y: auto;
  }

  header {
    margin-bottom: 14px;
  }

  header p {
    margin: 8px 0 0;
    color: rgb(255 255 255 / 0.6);
    font-size: 11.5px;
  }

  .message {
    color: var(--text-soft);
  }
</style>
