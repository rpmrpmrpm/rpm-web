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
  import { icons } from '../../design/icons';
  import HomeBanner from './HomeBanner.svelte';
  import QuickSelection, { type QuickEntry } from './QuickSelection.svelte';
  import Shelf from './Shelf.svelte';

  let { onOpen, onImport }: { onOpen: (album: CloudAlbum) => void; onImport: () => void } = $props();

  // Under this the screen cannot answer its own headings, so it says what it is waiting for. HomeGate on the desktop.
  const LEAST_ALBUMS = 25;
  const RING_RADIUS = 89.5;
  const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

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
    {#if library.albums.length >= LEAST_ALBUMS}<p>{albumCount(library.albums.length)}</p>{/if}
  </header>

  {#if library.state === 'ready' && library.albums.length < LEAST_ALBUMS}
    {@const toGo = LEAST_ALBUMS - library.albums.length}
    <div class="gate">
      <svg class="ring" viewBox="0 0 188 188" role="presentation">
        <defs>
          <linearGradient id="ring-ink" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0371d0" />
            <stop offset="1" stop-color="#04c8ff" />
          </linearGradient>
        </defs>
        <circle class="track" cx="94" cy="94" r={RING_RADIUS} />
        <circle class="arc" cx="94" cy="94" r={RING_RADIUS} stroke-dasharray="{(library.albums.length / LEAST_ALBUMS) * RING_LENGTH} {RING_LENGTH}" />
      </svg>
      <div class="words">
        <span class="kicker">{text('HomeLock_Kicker')}</span>
        <h3>{toGo === 1 ? text('HomeLock_ToGoOne') : text('HomeLock_ToGo', toGo)}</h3>
        <p class="body">{text('HomeLock_Body')}</p>
        <p class="progress">{text('HomeLock_Progress', library.albums.length, LEAST_ALBUMS)}</p>
        <button class="glass-button primary add" onclick={onImport}><i class="icon">{icons.plus}</i>{text('HomeLock_AddMusic')}</button>
      </div>
    </div>
  {:else}
    <HomeBanner {cards} {albumOf} {onOpen} />
    <QuickSelection {entries} />

    {#each rows as row (row.kind)}
      <Shelf title={text(TITLES[row.kind])} albums={row.albums} {onOpen} />
    {/each}
  {/if}
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
    margin: 0;
    color: rgb(255 255 255 / 0.55);
    font-size: 11px;
    line-height: 15px;
  }

  .gate {
    display: flex;
    flex: 1;
    gap: 44px;
    align-items: center;
    justify-content: center;
    margin: 24px;
  }

  .ring {
    flex: none;
    width: 188px;
    height: 188px;
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 9;
  }

  .track {
    stroke: rgb(255 255 255 / 0.11);
  }

  .arc {
    stroke: url(#ring-ink);
    stroke-linecap: round;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 17px;
    align-items: flex-start;
    max-width: 470px;
  }

  .kicker {
    color: rgb(255 255 255 / 0.42);
    font-size: 11px;
    letter-spacing: 0.22em;
  }

  h3 {
    margin: 0;
    color: #fff;
    font-size: 31px;
    font-weight: 700;
    line-height: 1.15;
  }

  .body {
    margin: 0;
    color: rgb(255 255 255 / 0.64);
    font-size: 13.5px;
    line-height: 21px;
  }

  .progress {
    margin: 0;
    color: rgb(255 255 255 / 0.42);
    font-size: 12px;
  }

  .add {
    gap: 9px;
    margin-top: 3px;
    padding: 0 22px;
    font-weight: 700;
  }

  .add .icon {
    font-size: 12px;
  }

  @media (max-width: 699px) {
    .gate {
      flex-direction: column;
      gap: 28px;
      margin: 12px 8px;
    }

    .ring {
      width: 140px;
      height: 140px;
    }

    .words {
      align-items: center;
      text-align: center;
    }
  }
</style>
