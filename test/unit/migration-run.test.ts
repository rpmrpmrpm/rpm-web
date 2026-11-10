import { describe, expect, it } from 'vitest';

import { QuotaFull } from '../../src/import/importer';
import { albumBatches, estimate, mergeDetails } from '../../src/migration/merge';
import { deviceId, type RemoteFile, type SourceLibrary, type SourceTrack } from '../../src/migration/model';
import { MemoryRecordStore, MigrationRecord } from '../../src/migration/record';
import { runMigration, type CatalogueTrack, type MigrationCloud, type RunProgress, type TrackImporter } from '../../src/migration/run';
import { ServerBlocked, SignInExpired, type MediaServer } from '../../src/migration/server';

const Y2015 = new Date('2015-03-04T05:06:07Z');
const Y2021 = new Date('2021-01-02T03:04:05Z');
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

function local(id: string, album: string, title: string, extra: Partial<SourceTrack> = {}): SourceTrack {
  return {
    sourceId: id, file: { kind: 'local', path: `/Users/test/Music/Band/${album}/${title}.flac` }, title, artist: 'Band', album, albumArtist: 'Band',
    trackNumber: 1, discNumber: 1, durationSeconds: 200, sizeBytes: 100, rating: 0, favorite: false, plays: 0, lastPlayed: null, added: null, ...extra,
  };
}

function remote(id: string, album: string, title: string): SourceTrack {
  return { ...local(id, album, title), file: { kind: 'remote', key: id, extension: '.flac', size: 100 } };
}

const library = (tracks: SourceTrack[], extra: Partial<SourceLibrary> = {}): SourceLibrary =>
  ({ kind: 'musicbee', libraryId: 'lib-1', name: 'MusicBee', tracks, playlists: [], skipped: [], ...extra });

class FakeImporter implements TrackImporter {
  calls: { path: string; addedAt: number }[] = [];
  known = new Set<string>();
  failing = new Set<string>();
  full = new Set<string>();
  // Answers to give before the real one, per path: no answer at all, or a failure to try again later.
  first = new Map<string, ('noanswer' | 'again')[]>();
  async importOne(file: File, path: string, addedAt: number) {
    this.calls.push({ path, addedAt });
    if (this.full.has(path)) throw new QuotaFull();
    const next = this.first.get(path)?.shift();
    if (next === 'noanswer') return { noAnswer: true as const };
    if (next === 'again') return { failed: 'Cloud_FailUnknown', final: false };
    if (this.failing.has(path)) return { failed: 'Cloud_FailUnreadable', final: true };
    return { rpmId: (this.known.has(path) ? 'held-' : 'id-') + file.name, known: this.known.has(path) };
  }
}

class FakeCloud implements MigrationCloud {
  space = { used: 0, quota: 0, unlimited: true };
  quotaFailures = 0;
  tracks: CatalogueTrack[] = [];
  marks: { rpmId: string; at: number }[] = [];
  ratings: { rpmId: string; rating: number }[] = [];
  plays: { device: string; rows: { rpmId: string; plays: number; lastPlayedAt: number }[] }[] = [];
  added: { rpmId: string; addedAt: number }[] = [];
  lists: { playlistId: string; name: string; folder: string[]; trackIds: string[] }[] = [];
  async quota() { return this.quotaFailures-- > 0 ? null : this.space; }
  catalogue() { return this.tracks; }
  async mark(rpmId: string, at: number) { this.marks.push({ rpmId, at }); }
  async putRatings(rows: { rpmId: string; rating: number }[]) { this.ratings.push(...rows); }
  async putPlays(device: string, rows: { rpmId: string; plays: number; lastPlayedAt: number }[]) { this.plays.push({ device, rows }); }
  async putAdded(rows: { rpmId: string; addedAt: number }[]) { this.added.push(...rows); }
  async playlists() { return this.lists.map((l) => ({ ...l })); }
  async createPlaylist(name: string, trackIds: string[], folder: string[]) {
    const playlistId = `pl-${this.lists.length + 1}`;
    this.lists.push({ playlistId, name, folder, trackIds: [...trackIds] });
    return playlistId;
  }
  async appendToPlaylist(id: string, trackIds: string[]) { this.lists.find((l) => l.playlistId === id)!.trackIds.push(...trackIds); }
  async fillIn(id: string, made: string[], whole: string[], fresh: string[]) {
    const list = this.lists.find((l) => l.playlistId === id)!;
    const untouched = list.trackIds.length === made.length && list.trackIds.every((t, i) => t === made[i]);
    list.trackIds = untouched ? [...whole] : [...list.trackIds, ...fresh];
    return untouched;
  }
}

class FakeServer implements MediaServer {
  readonly kind = 'jellyfin' as const;
  expired = false;
  unreachable = 0;
  opens = 0;
  async read(): Promise<SourceLibrary> { throw new Error('not used'); }
  async open(file: RemoteFile) {
    this.opens++;
    if (this.expired) throw new SignInExpired();
    if (this.unreachable-- > 0) throw new ServerBlocked();
    return new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' });
  }
}

const picked = (lib: SourceLibrary, skip: string[] = []) =>
  new Map(lib.tracks.filter((t) => t.file.kind === 'local' && !skip.includes(t.sourceId)).map((t) => {
    const path = (t.file as { path: string }).path;
    return [t.sourceId, { file: new File([new Uint8Array(4)], path.split('/').pop()!), path: path.slice(1) }];
  }));

async function run(lib: SourceLibrary, options: { store?: MemoryRecordStore; importer?: FakeImporter; cloud?: FakeCloud; server?: MediaServer | null; skip?: string[]; signal?: AbortSignal; onProgress?: (p: RunProgress) => void } = {}) {
  const store = options.store ?? new MemoryRecordStore();
  const record = await MigrationRecord.open(store, 'user-1', lib);
  const importer = options.importer ?? new FakeImporter();
  const cloud = options.cloud ?? new FakeCloud();
  // A clock the waits move on, so a backoff of minutes takes no time.
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const stages: string[] = [];
  const end = await runMigration({
    library: lib, record, importer, cloud, server: options.server ?? null, picked: picked(lib, options.skip),
    label: lib.name, progress: (p) => { stages.push(p.stage); options.onProgress?.(p); }, signal: options.signal ?? new AbortController().signal,
    now: () => clock,
    delay: async (ms) => { clock += ms; },
  });
  return { end, record, importer, cloud, store, stages };
}

describe('the web import run', () => {
  it('imports local files and sends their details', async () => {
    const lib = library([local('s1', 'Record', 'One', { rating: 8, favorite: true, plays: 5, lastPlayed: Y2021, added: Y2015 }), local('s2', 'Record', 'Two')]);

    const { end, record, importer, cloud } = await run(lib);

    expect(end).toBe('finished');
    expect(record.counts()).toEqual({ found: 2, imported: 2, alreadyInRpm: 0, notImported: 0, waiting: 0 });
    expect(importer.calls.map((c) => c.addedAt)[0]).toBe(seconds(Y2015));
    expect(cloud.ratings).toEqual([{ rpmId: 'id-One.flac', rating: 8 }]);
    expect(cloud.marks.map((m) => m.rpmId)).toEqual(['id-One.flac']);
    expect(cloud.plays).toEqual([{ device: deviceId(lib), rows: [{ rpmId: 'id-One.flac', plays: 5, lastPlayedAt: seconds(Y2021) }] }]);
    expect(record.unfinished).toBe(false);
  });

  it('reports a file that was not in the picked folder', async () => {
    const lib = library([local('s1', 'Record', 'One')]);

    const { record } = await run(lib, { skip: ['s1'] });

    expect(record.rows('notimported')).toEqual([expect.objectContaining({ sourceId: 's1', reason: 'Migration_ReasonFileNotFound', detail: '/Users/test/Music/Band/Record/One.flac' })]);
  });

  it('merges a song the account already holds, by its tags, without uploading', async () => {
    const cloud = new FakeCloud();
    cloud.tracks = [{ rpmId: 'cloud-1', artist: 'band', album: 'RECORD', title: 'one', durationSeconds: 201, extension: '.mp3', favorite: false, rating: 0, addedAt: seconds(Y2021) }];
    const lib = library([local('s1', 'Record', 'One', { rating: 6, favorite: true, added: Y2015 })]);

    const { record, importer } = await run(lib, { cloud });

    expect(importer.calls).toHaveLength(0);
    expect(record.rows('already')).toEqual([expect.objectContaining({ sourceId: 's1', rpmId: 'cloud-1', reason: 'Migration_ReasonLowerQualityInRpm' })]);
    expect(cloud.ratings).toEqual([{ rpmId: 'cloud-1', rating: 6 }]);
    expect(cloud.added).toEqual([{ rpmId: 'cloud-1', addedAt: seconds(Y2015) }]);
    expect(cloud.marks.map((m) => m.rpmId)).toEqual(['cloud-1']);
  });

  it('matches a song whose artist or album rpm corrected, but not the same title on another record', async () => {
    const cloud = new FakeCloud();
    cloud.tracks = [
      { rpmId: 'cloud-1', artist: 'Beyoncé', album: 'Record', title: 'One', durationSeconds: 200, extension: '.flac', favorite: false, rating: 0, addedAt: 1 },
      { rpmId: 'cloud-2', artist: 'Band', album: 'Record (Deluxe Edition)', title: 'Two!', durationSeconds: 200, extension: '.flac', favorite: false, rating: 0, addedAt: 1 },
      { rpmId: 'cloud-3', artist: 'Other Act', album: 'Elsewhere', title: 'Intro', durationSeconds: 200, extension: '.flac', favorite: false, rating: 0, addedAt: 1 },
    ];
    const lib = library([local('s1', 'Record', 'One', { artist: 'Beyonce' }), local('s2', 'Record', 'Two'), local('s3', 'Record', 'Intro')]);

    const { record, importer } = await run(lib, { cloud });

    expect(record.rows('already').map((r) => [r.sourceId, r.rpmId])).toEqual([['s1', 'cloud-1'], ['s2', 'cloud-2']]);
    expect(importer.calls).toHaveLength(1);
  });

  it('keeps a rating the account already has', async () => {
    const cloud = new FakeCloud();
    cloud.tracks = [{ rpmId: 'cloud-1', artist: 'Band', album: 'Record', title: 'One', durationSeconds: 200, extension: '.flac', favorite: true, rating: 3, addedAt: 1 }];

    await run(library([local('s1', 'Record', 'One', { rating: 9, favorite: true })]), { cloud });

    expect(cloud.ratings).toEqual([]);
    expect(cloud.marks).toEqual([]);
  });

  it('counts a track the importer found already held as already in rpm', async () => {
    const importer = new FakeImporter();
    importer.known.add('Users/test/Music/Band/Record/One.flac');

    const { record } = await run(library([local('s1', 'Record', 'One')]), { importer });

    expect(record.rows('already')).toEqual([expect.objectContaining({ rpmId: 'held-One.flac' })]);
  });

  it('pauses on an expired server sign-in and keeps the track waiting', async () => {
    const server = new FakeServer();
    server.expired = true;

    const { end, record } = await run(library([remote('j1', 'Record', 'One')], { kind: 'jellyfin' }), { server });

    expect(end).toBe('signin');
    expect(record.due(Date.now()).map((r) => r.sourceId)).toEqual(['j1']);
  });

  it('downloads a server track and imports it', async () => {
    const { end, record, importer } = await run(library([remote('j1', 'Record', 'One')], { kind: 'jellyfin' }), { server: new FakeServer() });

    expect(end).toBe('finished');
    expect(importer.calls).toHaveLength(1);
    expect(record.counts().imported).toBe(1);
  });

  it('continues where it stopped, from what the store kept', async () => {
    const lib = library([local('s1', 'Record', 'One'), local('s2', 'Record', 'Two'), local('s3', 'Record', 'Three')]);
    const store = new MemoryRecordStore();
    const stop = new AbortController();
    const importer = new FakeImporter();

    const first = await run(lib, { store, importer, signal: stop.signal, onProgress: () => { if (importer.calls.length >= 1) stop.abort(); } });
    const second = await run(lib, { store, importer });

    expect(first.end).toBe('paused');
    expect(second.end).toBe('finished');
    expect(importer.calls.map((c) => c.path)).toEqual(['Users/test/Music/Band/Record/One.flac', 'Users/test/Music/Band/Record/Two.flac', 'Users/test/Music/Band/Record/Three.flac']);
    expect(second.record.counts().imported).toBe(3);
  });

  it('imports only new tracks on a second run and replaces the plays', async () => {
    const store = new MemoryRecordStore();
    const cloud = new FakeCloud();
    const importer = new FakeImporter();
    await run(library([local('s1', 'Record', 'One', { plays: 10 })]), { store, cloud, importer });

    await run(library([local('s1', 'Record', 'One', { plays: 12 }), local('s2', 'Record', 'Two')]), { store, cloud, importer });

    expect(importer.calls).toHaveLength(2);
    expect(cloud.plays.map((p) => p.rows.map((r) => r.plays))).toEqual([[10], [12]]);
  });

  it('takes albums whole when the cloud fills up', async () => {
    const cloud = new FakeCloud();
    cloud.space = { used: 0, quota: 250, unlimited: false };
    const lib = library([local('a1', 'First', 'One'), local('a2', 'First', 'Two'), local('b1', 'Second', 'One'), local('b2', 'Second', 'Two')]);

    const { end, record } = await run(lib, { cloud });

    expect(end).toBe('cloudfull');
    expect(record.counts().imported).toBe(2);
    expect(record.due(Date.now()).map((r) => r.sourceId)).toEqual(['b1', 'b2']);
  });

  it('stops when the store says it is full', async () => {
    const importer = new FakeImporter();
    importer.full.add('Users/test/Music/Band/Record/Two.flac');

    const { end, record } = await run(library([local('s1', 'Record', 'One'), local('s2', 'Record', 'Two')]), { importer });

    expect(end).toBe('cloudfull');
    expect(record.counts().imported).toBe(1);
  });

  it('adds playlists in order, with repeats and folders, renaming a clash', async () => {
    const cloud = new FakeCloud();
    cloud.lists = [{ playlistId: 'mine', name: 'Mix', folder: [], trackIds: [] }];
    const lib = library([local('a', 'Record', 'A'), local('b', 'Record', 'B')], {
      playlists: [
        { sourceId: 'p1', name: 'Mix', folder: [], smart: false, trackIds: ['b', 'a', 'b'], unresolved: [] },
        { sourceId: 'p2', name: 'Late', folder: ['Moods', 'Evening'], smart: true, trackIds: ['a', 'x'], unresolved: ['999'] },
      ],
    });

    const { record } = await run(lib, { cloud });

    expect(cloud.lists.slice(1)).toEqual([
      { playlistId: 'pl-2', name: 'Mix (MusicBee)', folder: [], trackIds: ['id-B.flac', 'id-A.flac', 'id-B.flac'] },
      { playlistId: 'pl-3', name: 'Late', folder: ['Moods', 'Evening'], trackIds: ['id-A.flac'] },
    ]);
    expect(record.playlistOutcomes).toEqual([
      { name: 'Mix (MusicBee)', entries: 3, unmatched: 0, wasSmart: false, renamed: true },
      { name: 'Late', entries: 1, unmatched: 2, wasSmart: true, renamed: false },
    ]);
  });

  it('waits for the connection and tries the same track again, without counting a failure', async () => {
    const importer = new FakeImporter();
    importer.first.set('Users/test/Music/Band/Record/One.flac', ['noanswer', 'noanswer', 'noanswer', 'noanswer', 'noanswer', 'noanswer']);

    const { end, record, stages } = await run(library([local('s1', 'Record', 'One')]), { importer });

    expect(end).toBe('finished');
    expect(record.counts().imported).toBe(1);
    expect(importer.calls).toHaveLength(7);
    expect(stages).toContain('waiting');
  });

  it('tries an upload that failed again later, and notes one the cloud cannot take', async () => {
    const importer = new FakeImporter();
    importer.first.set('Users/test/Music/Band/Record/One.flac', ['again', 'again']);
    importer.failing.add('Users/test/Music/Band/Record/Two.flac');

    const { end, record } = await run(library([local('s1', 'Record', 'One'), local('s2', 'Record', 'Two')]), { importer });

    expect(end).toBe('finished');
    expect(record.rows('imported').map((r) => r.sourceId)).toEqual(['s1']);
    expect(record.rows('notimported')).toEqual([expect.objectContaining({ sourceId: 's2', reason: 'Cloud_FailUnreadable' })]);
  });

  it('waits for a quota that could not be read instead of stopping', async () => {
    const cloud = new FakeCloud();
    cloud.space = { used: 0, quota: 1_000_000, unlimited: false };
    cloud.quotaFailures = 3;

    const { end, record, stages } = await run(library([local('s1', 'Record', 'One')]), { cloud });

    expect(end).toBe('finished');
    expect(record.counts().imported).toBe(1);
    expect(stages).toContain('waiting');
  });

  it('waits for a media server that gives no answer, without counting a failure', async () => {
    const server = new FakeServer();
    server.unreachable = 8;

    const { end, record } = await run(library([remote('j1', 'Record', 'One')], { kind: 'jellyfin' }), { server });

    expect(end).toBe('finished');
    expect(record.counts().imported).toBe(1);
    expect(server.opens).toBe(9);
  });

  it('tries the tracks that failed before on a new run', async () => {
    const store = new MemoryRecordStore();
    const lib = library([local('s1', 'Record', 'One')]);
    await run(lib, { store, skip: ['s1'] });

    const { end, record } = await run(lib, { store });

    expect(end).toBe('finished');
    expect(record.counts()).toEqual({ found: 1, imported: 1, alreadyInRpm: 0, notImported: 0, waiting: 0 });
  });

  it('uploads one file listed under two ids once', async () => {
    const lib = library([local('i1', 'Record', 'One'), { ...local('i2', 'Record', 'One (live)'), file: { kind: 'local', path: '/Users/test/Music/Band/Record/One.flac' } }]);
    const importer = new FakeImporter();

    const { record } = await run(lib, { importer });

    expect(importer.calls).toHaveLength(1);
    expect(record.rows('already')).toEqual([expect.objectContaining({ sourceId: 'i2', rpmId: 'id-One.flac' })]);
  });

  it('uploads one song listed twice with the same tags once', async () => {
    const lib = library([local('i1', 'Record', 'One'), { ...local('i2', 'Record', 'One'), file: { kind: 'local', path: '/Users/test/Music/Copy/One.flac' } }]);
    const importer = new FakeImporter();

    await run(lib, { importer });

    expect(importer.calls).toHaveLength(1);
  });

  it('puts the tracks that arrive after a stop in their playlist places', async () => {
    const store = new MemoryRecordStore();
    const cloud = new FakeCloud();
    cloud.space = { used: 0, quota: 150, unlimited: false };
    const tracks = [local('a1', 'First', 'Alpha'), local('b1', 'Second', 'Beta'), local('b2', 'Second', 'Gamma')];
    const lib = library(tracks, { playlists: [{ sourceId: 'p1', name: 'Mix', folder: [], smart: false, trackIds: ['b1', 'a1', 'b2'], unresolved: [] }] });

    const first = await run(lib, { store, cloud });
    cloud.space = { used: 100, quota: 1000, unlimited: false };
    await run(lib, { store, cloud });

    expect(first.end).toBe('cloudfull');
    expect(cloud.lists[0]!.trackIds).toEqual(['id-Beta.flac', 'id-Alpha.flac', 'id-Gamma.flac']);
  });

  it('sends no date before 1970 or after now', async () => {
    const future = new Date('2099-01-01T00:00:00Z');
    const old = new Date('1950-01-01T00:00:00Z');
    const cloud = new FakeCloud();
    cloud.tracks = [{ rpmId: 'cloud-1', artist: 'Band', album: 'Record', title: 'Two', durationSeconds: 200, extension: '.flac', favorite: false, rating: 0, addedAt: seconds(Y2021) }];
    const lib = library([local('s1', 'Record', 'One', { added: future, lastPlayed: future, plays: 1 }), local('s2', 'Record', 'Two', { added: old })]);

    const { importer } = await run(lib, { cloud });

    const now = Date.parse('2026-01-01T00:00:00Z') / 1000;
    expect(importer.calls[0]!.addedAt).toBe(now);
    expect(cloud.added).toEqual([]);
    expect(cloud.plays.flatMap((p) => p.rows.map((r) => r.lastPlayedAt))).toEqual([0]);
  });

  it('appends only new playlist entries on a second run', async () => {
    const store = new MemoryRecordStore();
    const cloud = new FakeCloud();
    const tracks = [local('a', 'Record', 'A'), local('b', 'Record', 'B'), local('c', 'Record', 'C')];
    await run(library(tracks, { playlists: [{ sourceId: 'p1', name: 'Mix', folder: [], smart: false, trackIds: ['a', 'b'], unresolved: [] }] }), { store, cloud });
    cloud.lists[0]!.trackIds = ['id-A.flac']; // the person took B out on the web

    await run(library(tracks, { playlists: [{ sourceId: 'p1', name: 'Mix', folder: [], smart: false, trackIds: ['a', 'b', 'c'], unresolved: [] }] }), { store, cloud });

    expect(cloud.lists).toHaveLength(1);
    expect(cloud.lists[0]!.trackIds).toEqual(['id-A.flac', 'id-C.flac']);
  });
});

describe('the record of an import', () => {
  it('finds an unfinished import without changing it', async () => {
    const store = new MemoryRecordStore();
    const lib = library([local('s1', 'Record', 'One'), local('s2', 'Record', 'Two')]);
    expect(await MigrationRecord.unfinished(store, 'user-1', lib)).toBeNull();

    const record = await MigrationRecord.open(store, 'user-1', lib);
    record.addFound(['s1', 's2']);
    record.note('s1', 'imported', 'id-1');
    await record.flush();

    expect(await MigrationRecord.unfinished(store, 'user-1', lib)).toEqual({ found: 2, imported: 1, alreadyInRpm: 0, notImported: 0, waiting: 1 });
    expect(await MigrationRecord.unfinished(store, 'user-2', lib)).toBeNull();

    record.finish();
    await record.flush();
    expect(await MigrationRecord.unfinished(store, 'user-1', lib)).toBeNull();
  });

  it('starts over by checking every track again, and keeps the playlists it made', async () => {
    const store = new MemoryRecordStore();
    const lib = library([local('s1', 'Record', 'One'), local('s2', 'Record', 'Two')]);
    const record = await MigrationRecord.open(store, 'user-1', lib);
    record.addFound(['s1', 's2']);
    record.note('s1', 'imported', 'id-1');
    record.note('s2', 'notimported', null, 'Migration_ReasonFileNotFound');
    record.notePlaylist('p1', 'pl-9', ['s1']);

    record.startOver();

    expect(record.due(Date.now()).map((r) => r.sourceId)).toEqual(['s1', 's2']);
    expect(record.counts()).toEqual({ found: 2, imported: 0, alreadyInRpm: 0, notImported: 0, waiting: 2 });
    expect(record.playlist('p1')).toEqual({ playlistId: 'pl-9', entries: ['s1'] });
  });
});

describe('other imports', () => {
  it('names the other libraries that brought tracks in, for the summary', async () => {
    const store = new MemoryRecordStore();
    const musicbee = library([local('s1', 'Record', 'One')]);
    const itunes = library([local('s1', 'Record', 'One')], { kind: 'itunes', libraryId: 'it-1', name: 'iTunes' });
    expect(await MigrationRecord.others(store, 'user-1', musicbee)).toEqual([]);

    const record = await MigrationRecord.open(store, 'user-1', itunes);
    record.addFound(['s1']);
    await record.flush();
    expect(await MigrationRecord.others(store, 'user-1', musicbee)).toEqual([]);

    record.note('s1', 'imported', 'id-1');
    await record.flush();
    expect(await MigrationRecord.others(store, 'user-1', musicbee)).toEqual(['iTunes']);
    expect(await MigrationRecord.others(store, 'user-1', itunes)).toEqual([]);
    expect(await MigrationRecord.others(store, 'user-2', musicbee)).toEqual([]);
  });
});

describe('the rules shared with the desktop', () => {
  it('merges details as the desktop does', () => {
    const source = local('s', 'R', 'T', { rating: 9, favorite: true, added: Y2015, lastPlayed: Y2021 });
    expect(mergeDetails({ rating: 4, favorite: false, favoritedAt: 0, added: seconds(Y2021), lastPlayed: 0 }, source)).toEqual({
      rating: 4, favorite: true, favoritedAt: seconds(Y2015), added: seconds(Y2015), lastPlayed: seconds(Y2021),
    });
  });

  it('estimates what the account has within two seconds, and groups albums', () => {
    const lib = library([local('a', 'R', 'One', { durationSeconds: 200, sizeBytes: 10 }), local('b', 'R', 'Two', { durationSeconds: 300, sizeBytes: 20 })]);
    expect(estimate(lib, [{ artist: 'band', album: 'r', title: 'ONE', durationSeconds: 201.9 }])).toEqual({ aboutAlreadyInRpm: 1, aboutBytesNeeded: 20, totalBytes: 30 });
    expect(albumBatches([local('1', 'B', 'x'), local('2', 'A', 'x'), local('3', 'B', 'y')]).map((b) => b.map((t) => t.sourceId))).toEqual([['1', '3'], ['2']]);
  });
});
