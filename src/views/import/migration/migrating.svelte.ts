// The import from another app, as the web app runs it: one at a time, kept running while its window is
// hidden, wired to the app's own importer, catalogue, favourites and playlists. Media server sign-ins are
// kept for the page's life only; after a reload the person signs in again.

import { api, catalogue, cloud, importMedia, playlists, session } from '../../../app';
import { readQuota } from '../../../api/wire';
import { browserTransfers, Importer } from '../../../import/importer';
import { ImportQueue, type ImportRow, type PickedFile } from '../../../import/queue';
import { utcTicks } from '../../../library/favorites';
import { JellyfinServer, type JellyfinSession } from '../../../migration/jellyfin';
import { estimate } from '../../../migration/merge';
import type { SourceLibrary } from '../../../migration/model';
import { PlexServer, type PlexServerChoice } from '../../../migration/plex';
import { browserRecords, MigrationRecord, type PlaylistOutcome, type RecordState } from '../../../migration/record';
import { runMigration, type CatalogueTrack, type MigrationCloud, type RunEnd, type RunProgress, type TrackImporter } from '../../../migration/run';
import type { MediaServer } from '../../../migration/server';
import { SubsonicServer, type SubsonicLogin } from '../../../migration/subsonic';

export type Connection =
  | { kind: 'musicbee' | 'itunes' | 'playlistfiles'; picked: Map<string, PickedFile> }
  | { kind: 'jellyfin'; session: JellyfinSession }
  | { kind: 'plex'; server: PlexServerChoice; connection: string }
  | { kind: 'navidrome'; login: SubsonicLogin };

export const fetcher = (url: string, init?: RequestInit) => fetch(url, init);

// A stable id for this browser, kept so a media server lists one device for it, not a new one per visit.
function stableId(name: string): string {
  try {
    const kept = localStorage.getItem(name);
    if (kept) return kept;
    const made = 'rpm-web-' + crypto.randomUUID();
    localStorage.setItem(name, made);
    return made;
  } catch {
    return 'rpm-web-' + crypto.randomUUID();
  }
}

export const jellyfinDevice = () => stableId('rpm-jellyfin-device');
export const plexClient = () => stableId('rpm-plex-client');

export function serverFor(connection: Connection): MediaServer | null {
  switch (connection.kind) {
    case 'jellyfin': return new JellyfinServer(fetcher, connection.session, jellyfinDevice());
    case 'plex': return new PlexServer(fetcher, connection.server, connection.connection);
    case 'navidrome': return new SubsonicServer(fetcher, connection.login);
    default: return null;
  }
}

export interface Report {
  label: string;
  counts: ReturnType<MigrationRecord['counts']>;
  notImported: { what: string; reasonKey: string; detail: string | null; sourceId: string }[];
  lowerQuality: string[];
  playlists: PlaylistOutcome[];
  skipped: { what: string; reasonKey: string }[];
}

class Migrating {
  running = $state(false);
  progress = $state<RunProgress | null>(null);
  end = $state<RunEnd | null>(null);
  report = $state<Report | null>(null);
  library = $state.raw<SourceLibrary | null>(null);
  connection = $state.raw<Connection | null>(null);
  label = $state('');
  // The window has shown the last finished import's report; it opens at the list of apps next time.
  reportSeen = false;
  // Not reactive: only Pause reads it.
  stop: AbortController | null = null;
}

export const migrating = new Migrating();

const leaving = (event: BeforeUnloadEvent) => event.preventDefault();

// What the summary shows: how many tracks the account probably has already, and the space the rest need.
export function summaryOf(library: SourceLibrary) {
  return estimate(library, catalogue.tracks.map((t) => ({ artist: t.artist ?? '', album: t.album ?? '', title: t.title ?? '', durationSeconds: t.tags?.durationSeconds ?? 0 })));
}

export async function cloudSpace(): Promise<{ used: number; quota: number; unlimited: boolean } | null> {
  try {
    const quota = await api.json('cloud/quota', readQuota);
    return { used: quota.usedBytes, quota: quota.quotaBytes, unlimited: quota.unlimited };
  } catch {
    return null;
  }
}

export async function unfinished(): Promise<RecordState[]> {
  const user = session.user?.userId;
  if (!user) return [];
  try {
    return (await browserRecords.list(`${user}:`)).filter((r) => r.finishedAt === 0);
  } catch {
    return [];
  }
}

// One file at a time through the app's own importer, in a queue of its own that is emptied after each
// file, so a large import never holds more than the file in hand.
function trackImporter(): TrackImporter {
  const queue = new ImportQueue();
  const importer = new Importer(api, importMedia, browserTransfers, catalogue, queue);
  return {
    async importOne(file, path, addedAt) {
      const unreadable = { failed: 'Migration_ReasonReadFailed', final: true };
      const [row] = queue.add([{ file, path }]);
      if (!row) return unreadable;
      try {
        if (row.state !== 'reading') return unreadable;
        try {
          const { tags, hasArt } = await importMedia.tags(file);
          queue.read(row, tags, hasArt);
        } catch {
          return unreadable;
        }
        const outcome = await importer.importOne(row, addedAt);
        if ('failed' in outcome) return outcome.noAnswer ? { noAnswer: true } : { failed: outcome.failed, final: outcome.final };
        // The importer moved the row on; it is read again rather than through the narrowed check above.
        return { rpmId: outcome.rpmId, known: (row as ImportRow).state === 'known' };
      } finally {
        queue.remove([row]);
      }
    },
  };
}

const migrationCloud: MigrationCloud = {
  quota: cloudSpace,
  catalogue(): CatalogueTrack[] {
    return catalogue.tracks.map((t) => ({
      rpmId: t.rpmId,
      artist: t.artist ?? '',
      album: t.album ?? '',
      title: t.title ?? '',
      durationSeconds: t.tags?.durationSeconds ?? 0,
      extension: t.tags?.extension ?? '',
      favorite: t.tags?.favorite === true,
      rating: t.tags?.rating ?? 0,
      addedAt: t.addedAt,
    }));
  },
  async mark(rpmId, favoritedAt) {
    await api.call(`cloud/track-mark/${encodeURIComponent(rpmId)}`, { method: 'PUT', body: { favorite: true, favoritedAt: utcTicks(favoritedAt * 1000) } });
  },
  putRatings: (rows) => cloud.putTrackRatings(rows),
  putPlays: (device, rows) => cloud.sendTrackPlays(device, rows),
  putAdded: (rows) => cloud.putTrackAdded(rows),
  async playlists() {
    return (await playlists.list()).map((p) => ({ playlistId: p.playlistId, name: p.name, folder: p.folder ?? [] }));
  },
  async createPlaylist(name, trackIds, folder) {
    return (await playlists.create(name, trackIds, folder)).playlistId;
  },
  fillIn: (id, made, whole, fresh) => playlists.fillIn(id, made, whole, fresh),
};

const what = (artist: string, title: string) => (artist ? `${artist} - ${title}` : title);

// The counts of an unfinished import of this library, or null. The summary then asks whether to continue it
// or start over.
export async function unfinishedImport(library: SourceLibrary): Promise<ReturnType<MigrationRecord['counts']> | null> {
  const user = session.user?.userId;
  if (!user) return null;
  try {
    return await MigrationRecord.unfinished(browserRecords, user, library);
  } catch {
    return null;
  }
}

// The other libraries imported into this account before, for the summary's note on plays counted twice.
export async function otherImports(library: SourceLibrary): Promise<string[]> {
  const user = session.user?.userId;
  if (!user) return [];
  try {
    return await MigrationRecord.others(browserRecords, user, library);
  } catch {
    return [];
  }
}

// how: continue where an earlier import of this library stopped (or start fresh when there was none), or start
// over and check every track again. retry: the tracks the report's "Try again" starts over.
export async function startMigration(library: SourceLibrary, connection: Connection, label: string, how: 'continue' | 'startover', retry: string[]): Promise<void> {
  const user = session.user?.userId;
  if (migrating.running || !user) return;

  migrating.running = true;
  migrating.library = library;
  migrating.connection = connection;
  migrating.label = label;
  migrating.end = null;
  migrating.report = null;
  migrating.reportSeen = false;
  migrating.progress = null;
  const stop = new AbortController();
  migrating.stop = stop;
  addEventListener('beforeunload', leaving);
  let lock: WakeLockSentinel | null = null;
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    // A page that may not hold the screen on still imports.
  }

  try {
    const record = await MigrationRecord.open(browserRecords, user, library);
    if (how === 'startover') record.startOver();
    if (retry.length > 0) record.retry(retry);
    const end = await runMigration({
      library,
      record,
      importer: trackImporter(),
      cloud: migrationCloud,
      server: serverFor(connection),
      picked: connection.kind === 'musicbee' || connection.kind === 'itunes' || connection.kind === 'playlistfiles' ? connection.picked : new Map(),
      label,
      progress: (progress) => (migrating.progress = progress),
      signal: stop.signal,
    });
    const bySource = new Map(library.tracks.map((t) => [t.sourceId, t]));
    migrating.report = {
      label,
      counts: record.counts(),
      notImported: record.rows('notimported').filter((r) => r.attempts >= 5).map((r) => {
        const track = bySource.get(r.sourceId);
        return { sourceId: r.sourceId, what: track ? what(track.artist, track.title) : r.sourceId, reasonKey: r.reason ?? 'Migration_ReasonReadFailed', detail: r.detail };
      }),
      lowerQuality: record.rows('already').filter((r) => r.reason === 'Migration_ReasonLowerQualityInRpm' && r.detail).map((r) => r.detail!),
      playlists: record.playlistOutcomes,
      skipped: library.skipped,
    };
    migrating.end = end;
  } catch (error) {
    // Not "paused": the person did not pause it, and must see that something went wrong.
    console.warn('The import from another app failed', error);
    migrating.end = 'failed';
  } finally {
    void lock?.release();
    removeEventListener('beforeunload', leaving);
    migrating.running = false;
    migrating.stop = null;
  }
  await catalogue.refresh();
}

export function pauseMigration() {
  migrating.stop?.abort();
}

// "12.4 GB", as the import pane writes sizes.
export const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
