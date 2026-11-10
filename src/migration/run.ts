// The web app's import run: the tracks of another app's library, matched against what the account holds,
// uploaded through the normal importer, with their details sent, one album at a time; then the
// playlists. It is RPM.Core/Migration/MigrationRun.cs of the desktop app, without the cloud-only staging
// (the web app always imports to the cloud, one file in memory at a time).

import type { PickedFile } from '../import/queue';
import { QuotaFull } from '../import/importer';
import { albumBatches, LENGTH_TOLERANCE, lossless, mergeDetails, songKey } from './merge';
import { deviceId, type SourceLibrary, type SourceTrack } from './model';
import type { MigrationRecord, PlaylistOutcome } from './record';
import { type MediaServer, SignInExpired } from './server';

// A track the account holds, as the matching reads it. Times are unix seconds.
export interface CatalogueTrack {
  rpmId: string;
  artist: string;
  album: string;
  title: string;
  durationSeconds: number;
  extension: string;
  favorite: boolean;
  rating: number;
  addedAt: number;
}

export interface MigrationCloud {
  quota(): Promise<{ used: number; quota: number; unlimited: boolean }>;
  catalogue(): readonly CatalogueTrack[];
  mark(rpmId: string, favoritedAt: number): Promise<void>;
  putRatings(rows: { rpmId: string; rating: number }[]): Promise<void>;
  putPlays(device: string, rows: { rpmId: string; plays: number; lastPlayedAt: number }[]): Promise<void>;
  putAdded(rows: { rpmId: string; addedAt: number }[]): Promise<void>;
  playlists(): Promise<{ playlistId: string; name: string; folder: string[] }[]>;
  createPlaylist(name: string, trackIds: string[], folder: string[]): Promise<string>;
  appendToPlaylist(id: string, trackIds: string[]): Promise<void>;
}

// One file into the account: its id, and whether the account held the audio already. Null when it failed
// for good. A full store throws QuotaFull.
export interface TrackImporter {
  importOne(file: File, path: string, addedAt: number): Promise<{ rpmId: string; known: boolean } | null>;
}

export type RunEnd = 'finished' | 'paused' | 'signin' | 'cloudfull';
export type Stage = 'tracks' | 'playlists' | 'finishing';

export interface RunProgress {
  stage: Stage;
  counts: ReturnType<MigrationRecord['counts']>;
  bytesDone: number;
  bytesTotal: number;
  album: string | null;
  timeLeft: number | null; // seconds
}

export interface RunOptions {
  library: SourceLibrary;
  record: MigrationRecord;
  importer: TrackImporter;
  cloud: MigrationCloud;
  server: MediaServer | null;
  picked: ReadonlyMap<string, PickedFile>;
  label: string; // shown in brackets on a renamed playlist
  progress: (progress: RunProgress) => void;
  signal: AbortSignal;
}

class Stop {
  constructor(readonly end: RunEnd) {}
}

const BATCH = 200;
const seconds = (at: Date | null) => (at ? Math.floor(at.getTime() / 1000) : 0);
const extensionOf = (track: SourceTrack) =>
  track.file.kind === 'remote' ? track.file.extension : (/\.[^./\\]+$/.exec(track.file.path)?.[0] ?? '').toLowerCase();

export async function runMigration(options: RunOptions): Promise<RunEnd> {
  const { library, record, cloud, signal } = options;
  const bySource = new Map(library.tracks.map((t) => [t.sourceId, t]));
  const catalogue = new Map<string, CatalogueTrack[]>();
  for (const track of cloud.catalogue()) {
    const key = songKey(track.artist, track.album, track.title);
    catalogue.set(key, [...(catalogue.get(key) ?? []), track]);
  }

  record.addFound(library.tracks.map((t) => t.sourceId));

  // A second run sends the source's current play totals for the tracks an earlier run brought in. They
  // replace the old ones on the source's device, so nothing is counted twice.
  const known = record.trackIds();
  const refreshed = library.tracks
    .filter((t) => known.has(t.sourceId) && (t.plays > 0 || t.lastPlayed))
    .map((t) => ({ rpmId: known.get(t.sourceId)!, plays: t.plays, lastPlayedAt: seconds(t.lastPlayed) }));
  for (let i = 0; i < refreshed.length; i += BATCH) await best(() => cloud.putPlays(deviceId(library), refreshed.slice(i, i + BATCH)));

  const total = library.tracks.reduce((sum, t) => sum + t.sizeBytes, 0);
  const albums: { at: number; bytes: number }[] = [];
  let current: string | null = null;
  let uploaded = 0;
  const space = await cloud.quota();

  const report = (stage: Stage) => {
    const finished = [...record.rows('imported'), ...record.rows('already'), ...record.rows('notimported').filter((r) => r.attempts >= 5)];
    const done = finished.reduce((sum, r) => sum + (bySource.get(r.sourceId)?.sizeBytes ?? 0), 0);
    let timeLeft: number | null = null;
    if (albums.length >= 3) {
      const recent = albums.slice(-10);
      const span = (recent[recent.length - 1]!.at - recent[0]!.at) / 1000;
      const bytes = recent.slice(1).reduce((sum, a) => sum + a.bytes, 0);
      if (span > 0 && bytes > 0 && total > done) timeLeft = (total - done) / (bytes / span);
    }
    options.progress({ stage, counts: record.counts(), bytesDone: done, bytesTotal: total, album: current, timeLeft });
  };

  try {
    for (;;) {
      const due = new Set(record.due(Date.now()).map((r) => r.sourceId));
      if (due.size === 0) {
        const next = record.nextTry();
        if (next === null) break;
        await wait(Math.max(0, next - Date.now()), signal);
        continue;
      }

      for (const album of albumBatches(library.tracks)) {
        const work = album.filter((t) => due.has(t.sourceId));
        if (work.length === 0) continue;
        if (!space.unlimited && space.used + uploaded + work.reduce((sum, t) => sum + t.sizeBytes, 0) > space.quota) throw new Stop('cloudfull');
        current = work[0]!.album || work[0]!.title;
        const sent = await albumRun(work);
        uploaded += sent;
        albums.push({ at: Date.now(), bytes: work.reduce((sum, t) => sum + t.sizeBytes, 0) });
        await record.flush();
        report('tracks');
      }
    }
  } catch (error) {
    await record.flush();
    if (error instanceof Stop) {
      if (error.end === 'cloudfull') await playlistStep();
      return error.end;
    }
    if (signal.aborted) return 'paused';
    throw error;
  }

  await playlistStep();
  report('finishing');
  record.finish();
  await record.flush();
  return 'finished';

  // One album: each track matched or uploaded, then its ratings, plays and dates in batches. The batches are
  // sent even when the album stops part-way.
  async function albumRun(work: SourceTrack[]): Promise<number> {
    const ratings: { rpmId: string; rating: number }[] = [];
    const plays: { rpmId: string; plays: number; lastPlayedAt: number }[] = [];
    const added: { rpmId: string; addedAt: number }[] = [];
    let sent = 0;
    try {
      for (const track of work) {
        if (signal.aborted) throw new Stop('paused');
        sent += await trackRun(track, ratings, plays, added);
        report('tracks');
      }
    } finally {
      for (let i = 0; i < ratings.length; i += BATCH) await best(() => cloud.putRatings(ratings.slice(i, i + BATCH)));
      for (let i = 0; i < plays.length; i += BATCH) await best(() => cloud.putPlays(deviceId(library), plays.slice(i, i + BATCH)));
      for (let i = 0; i < added.length; i += BATCH) await best(() => cloud.putAdded(added.slice(i, i + BATCH)));
    }
    return sent;
  }

  async function trackRun(
    track: SourceTrack,
    ratings: { rpmId: string; rating: number }[],
    plays: { rpmId: string; plays: number; lastPlayedAt: number }[],
    added: { rpmId: string; addedAt: number }[],
  ): Promise<number> {
    // A song the account holds already, by its tags and length: merged, not uploaded.
    const same = catalogue.get(songKey(track.artist, track.album, track.title))?.find((c) => Math.abs(c.durationSeconds - track.durationSeconds) <= LENGTH_TOLERANCE);
    if (same) {
      const lower = lossless(extensionOf(track)) && !lossless(same.extension);
      details(same.rpmId, { rating: same.rating, favorite: same.favorite, favoritedAt: 0, added: same.addedAt, lastPlayed: 0 }, track, ratings, plays, added);
      record.note(track.sourceId, 'already', same.rpmId, lower ? 'Migration_ReasonLowerQualityInRpm' : null, lower && track.file.kind === 'local' ? track.file.path : null);
      return 0;
    }

    let file: File;
    let path: string;
    if (track.file.kind === 'local') {
      const pick = options.picked.get(track.sourceId);
      if (!pick) {
        record.note(track.sourceId, 'notimported', null, 'Migration_ReasonFileNotFound', track.file.path);
        return 0;
      }
      file = pick.file;
      path = pick.path;
    } else {
      if (!options.server) throw new Error('A media server track needs the server.');
      try {
        const blob = await options.server.open(track.file, signal);
        const name = `${track.title || track.sourceId}${track.file.extension}`.replace(/[/\\]/g, '_');
        file = new File([blob], name, { type: blob.type });
        path = `${track.albumArtist || track.artist}/${track.album}/${name}`;
      } catch (error) {
        if (error instanceof SignInExpired) throw new Stop('signin');
        if (signal.aborted) throw new Stop('paused');
        record.noteFailure(track.sourceId, 'Migration_ReasonReadFailed', Date.now());
        return 0;
      }
    }

    let result: { rpmId: string; known: boolean } | null;
    try {
      result = await options.importer.importOne(file, path, seconds(track.added) || Math.floor(Date.now() / 1000));
    } catch (error) {
      if (error instanceof QuotaFull) throw new Stop('cloudfull');
      throw error;
    }
    if (!result) {
      record.note(track.sourceId, 'notimported', null, 'Migration_ReasonReadFailed', null);
      return 0;
    }

    const account = { rating: 0, favorite: false, favoritedAt: 0, added: result.known ? 0 : seconds(track.added), lastPlayed: 0 };
    details(result.rpmId, account, track, ratings, plays, result.known ? added : []);
    record.note(track.sourceId, result.known ? 'already' : 'imported', result.rpmId);
    return result.known ? 0 : track.sizeBytes;
  }

  function details(
    rpmId: string,
    account: { rating: number; favorite: boolean; favoritedAt: number; added: number; lastPlayed: number },
    track: SourceTrack,
    ratings: { rpmId: string; rating: number }[],
    plays: { rpmId: string; plays: number; lastPlayedAt: number }[],
    added: { rpmId: string; addedAt: number }[],
  ) {
    const merged = mergeDetails(account, track);
    if (account.rating === 0 && merged.rating > 0) ratings.push({ rpmId, rating: merged.rating });
    if (merged.favorite && !account.favorite) void best(() => cloud.mark(rpmId, merged.favoritedAt));
    if (track.plays > 0 || track.lastPlayed) plays.push({ rpmId, plays: track.plays, lastPlayedAt: seconds(track.lastPlayed) });
    if (merged.added > 0 && (account.added === 0 || merged.added < account.added)) added.push({ rpmId, addedAt: merged.added });
  }

  // The source's playlists with the tracks that are in the account. The first time a playlist is created
  // (a name taken by one the person made gets the source's name in brackets); after that only the new
  // entries are added to the end. Nothing is removed or reordered.
  async function playlistStep() {
    report('playlists');
    const trackIds = record.trackIds();
    const existing = await cloud.playlists();
    const outcomes: PlaylistOutcome[] = [];
    for (const playlist of library.playlists) {
      const resolved = playlist.trackIds.filter((id) => trackIds.has(id));
      const unmatched = playlist.unresolved.length + playlist.trackIds.length - resolved.length;
      const before = record.playlist(playlist.sourceId);
      if (before) {
        const node = existing.find((p) => p.playlistId === before.playlistId);
        if (!node) {
          outcomes.push({ name: playlist.name, entries: 0, unmatched, wasSmart: playlist.smart, renamed: false });
          continue;
        }
        const left = new Map<string, number>();
        for (const id of before.entries) left.set(id, (left.get(id) ?? 0) + 1);
        const fresh = resolved.filter((id) => {
          const n = left.get(id) ?? 0;
          if (n > 0) left.set(id, n - 1);
          return n === 0;
        });
        if (fresh.length > 0) await cloud.appendToPlaylist(node.playlistId, fresh.map((id) => trackIds.get(id)!));
        const entries = [...before.entries, ...fresh];
        record.notePlaylist(playlist.sourceId, node.playlistId, entries);
        outcomes.push({ name: node.name, entries: entries.length, unmatched, wasSmart: playlist.smart, renamed: false });
        continue;
      }
      let name = playlist.name.trim() || options.label;
      const taken = existing.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.folder.join('/') === playlist.folder.join('/'));
      if (taken) name = `${name} (${options.label})`;
      const id = await cloud.createPlaylist(name, resolved.map((s) => trackIds.get(s)!), playlist.folder);
      record.notePlaylist(playlist.sourceId, id, resolved);
      outcomes.push({ name, entries: resolved.length, unmatched, wasSmart: playlist.smart, renamed: taken });
    }
    record.playlistOutcomes = outcomes;
    await record.flush();
  }
}

// A detail that does not reach the cloud is sent again by the next run; it never stops the import.
async function best(send: () => Promise<void>) {
  try {
    await send();
  } catch {
    // Best effort.
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      fail(new DOMException('Paused', 'AbortError'));
    }, { once: true });
  });
}
