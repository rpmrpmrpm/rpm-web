// The record of an import from another app, per account: one row per track the source listed, one per
// playlist imported. It is what lets an import continue after the tab was closed and a second import
// bring only what is new. It is LibraryDatabase.MigrationRecord of the desktop app, kept in IndexedDB.
//
// The whole record of one import is one object. It is written after each album and when the run stops,
// not after each track; a track that landed in the last moments before the tab closed is found again by
// its audio (the importer's "already there") on the next run, so nothing is uploaded twice.

import { shortHash, type SourceKind, type SourceLibrary } from './model';

export type TrackState = 'found' | 'imported' | 'already' | 'notimported';

export interface TrackRow {
  state: TrackState;
  attempts: number;
  nextTry: number; // ms since 1970
  reason: string | null;
  detail: string | null;
  rpmId: string | null;
}

export interface RecordState {
  key: string;
  kind: SourceKind;
  libraryKey: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  order: string[];
  tracks: Record<string, TrackRow>;
  playlists: Record<string, { playlistId: string; entries: string[] }>;
}

export interface RecordStore {
  load(key: string): Promise<RecordState | null>;
  save(state: RecordState): Promise<void>;
  list(prefix: string): Promise<RecordState[]>;
  // Forgets an import: it is no longer offered, and a new import of that library starts fresh.
  remove(key: string): Promise<void>;
}

export interface PlaylistOutcome {
  name: string;
  entries: number;
  unmatched: number;
  wasSmart: boolean;
  renamed: boolean;
}

const MAX_ATTEMPTS = 5;
// The same wait as a failed upload on the desktop: 1, 2, 4, 8, 16 minutes, then 16.
const backoff = (attempts: number) => Math.min(2 ** Math.max(0, attempts), 16) * 60_000;

type Tally = { found: number; imported: number; alreadyInRpm: number; notImported: number };

// Which count a row is in: a not-imported row counts only once it has no attempts left.
const counted = (row: TrackRow): keyof Tally | null =>
  row.state === 'imported' ? 'imported' : row.state === 'already' ? 'alreadyInRpm' : row.state === 'notimported' && row.attempts >= MAX_ATTEMPTS ? 'notImported' : null;

export class MigrationRecord {
  playlistOutcomes: PlaylistOutcome[] = [];

  // The counts, kept as rows change, so the progress after each track does not read every row. A library of
  // tens of thousands of tracks would otherwise cost the square of its size.
  private readonly tally: Tally = { found: 0, imported: 0, alreadyInRpm: 0, notImported: 0 };

  private constructor(private readonly store: RecordStore, private readonly state: RecordState) {
    for (const row of Object.values(state.tracks)) this.count(row, 1);
  }

  private count(row: TrackRow, by: 1 | -1) {
    this.tally.found += by;
    const key = counted(row);
    if (key) this.tally[key] += by;
  }

  // Every change of a row goes through here, so the counts stay right.
  private change(row: TrackRow, values: Partial<TrackRow>) {
    this.count(row, -1);
    Object.assign(row, values);
    this.count(row, 1);
  }

  // Playlist files have no library id; the sorted paths of the playlists stand in.
  private static async keys(userId: string, library: SourceLibrary) {
    const libraryKey = library.libraryId || (library.kind === 'playlistfiles' ? await shortHash(library.playlists.map((p) => p.sourceId).sort().join('\n')) : '');
    return { libraryKey, key: `${userId}:${library.kind}:${libraryKey}` };
  }

  // The counts of an unfinished import of this library, or null when there is none (never imported, or
  // finished). It changes nothing, so the window can ask whether to continue it or start over first.
  static async unfinished(store: RecordStore, userId: string, library: SourceLibrary) {
    const { key } = await MigrationRecord.keys(userId, library);
    const state = await store.load(key);
    return state && state.finishedAt === 0 ? new MigrationRecord(store, state).counts() : null;
  }

  // The names of the other source libraries that brought tracks into this account. Each one counts its plays
  // on a device of its own, so two that hold the same history count those plays twice; the summary says so.
  static async others(store: RecordStore, userId: string, library: SourceLibrary): Promise<string[]> {
    const { key } = await MigrationRecord.keys(userId, library);
    return (await store.list(`${userId}:`))
      .filter((r) => r.key !== key && Object.values(r.tracks).some((t) => t.state === 'imported' || t.state === 'already'))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((r) => r.name);
  }

  static async open(store: RecordStore, userId: string, library: SourceLibrary): Promise<MigrationRecord> {
    const { libraryKey, key } = await MigrationRecord.keys(userId, library);
    const state = (await store.load(key)) ?? {
      key, kind: library.kind, libraryKey, name: library.name, startedAt: Date.now(), finishedAt: 0, order: [], tracks: {}, playlists: {},
    };
    state.finishedAt = 0;
    state.name = library.name;
    return new MigrationRecord(store, state);
  }

  get key() { return this.state.key; }
  get unfinished() { return this.state.finishedAt === 0; }

  addFound(sourceIds: readonly string[]) {
    for (const id of sourceIds) {
      if (this.state.tracks[id]) continue;
      const row: TrackRow = { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null, rpmId: null };
      this.state.tracks[id] = row;
      this.state.order.push(id);
      this.count(row, 1);
    }
  }

  // "Start over": every track is checked again, as on a first run. The tracks that are in the account already
  // are found by the matching and not uploaded twice. The links to the playlists stay, so they are filled in
  // and not made a second time.
  startOver() {
    for (const row of Object.values(this.state.tracks)) {
      this.change(row, { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null, rpmId: null });
    }
  }

  // At the start of each run, the tracks that were not imported go back to waiting, with no attempts counted,
  // so a run after the server was asleep or a file was missing tries them again.
  reopenFailed() {
    for (const row of Object.values(this.state.tracks)) {
      if (row.state === 'notimported') this.change(row, { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null });
    }
  }

  // The tracks to work on now, in the source's order.
  due(now: number): (TrackRow & { sourceId: string })[] {
    return this.state.order
      .map((sourceId) => ({ sourceId, ...this.state.tracks[sourceId]! }))
      .filter((r) => r.state === 'found' || (r.state === 'notimported' && r.attempts < MAX_ATTEMPTS && r.nextTry <= now));
  }

  // When the next track waiting to be tried again is due, or null when none waits.
  nextTry(): number | null {
    let next: number | null = null;
    for (const row of Object.values(this.state.tracks)) {
      if (row.state === 'notimported' && row.attempts < MAX_ATTEMPTS && (next === null || row.nextTry < next)) next = row.nextTry;
    }
    return next;
  }

  rows(state: TrackState): (TrackRow & { sourceId: string })[] {
    return this.state.order.map((sourceId) => ({ sourceId, ...this.state.tracks[sourceId]! })).filter((r) => r.state === state);
  }

  // A final state. 'notimported' written here is not tried again.
  note(sourceId: string, state: TrackState, rpmId: string | null = null, reason: string | null = null, detail: string | null = null) {
    const row = this.state.tracks[sourceId];
    if (!row) return;
    this.change(row, { state, rpmId: rpmId ?? row.rpmId, reason, detail, attempts: state === 'notimported' ? MAX_ATTEMPTS : row.attempts });
  }

  noteFailure(sourceId: string, reason: string, now: number) {
    const row = this.state.tracks[sourceId];
    if (!row) return;
    this.change(row, { state: 'notimported', reason, attempts: row.attempts + 1, nextTry: now + backoff(row.attempts) });
  }

  retry(sourceIds: readonly string[]) {
    for (const id of sourceIds) {
      const row = this.state.tracks[id];
      if (row?.state === 'notimported') this.change(row, { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null });
    }
  }

  counts() {
    const { found, imported, alreadyInRpm, notImported } = this.tally;
    return { found, imported, alreadyInRpm, notImported, waiting: found - imported - alreadyInRpm - notImported };
  }

  // Whether a track is through: in the account, or not imported with no attempts left.
  through(sourceId: string): boolean {
    const row = this.state.tracks[sourceId];
    return row !== undefined && counted(row) !== null;
  }

  // The track id of every source track that is in the account, by source id.
  trackIds(): Map<string, string> {
    return new Map(Object.entries(this.state.tracks).filter(([, r]) => (r.state === 'imported' || r.state === 'already') && r.rpmId).map(([id, r]) => [id, r.rpmId!]));
  }

  playlist(sourceId: string) { return this.state.playlists[sourceId] ?? null; }

  notePlaylist(sourceId: string, playlistId: string, entries: string[]) {
    this.state.playlists[sourceId] = { playlistId, entries };
  }

  finish() { this.state.finishedAt = Date.now(); }

  flush(): Promise<void> { return this.store.save(structuredClone(this.state)); }
}

export class MemoryRecordStore implements RecordStore {
  private readonly records = new Map<string, RecordState>();
  async load(key: string) { const found = this.records.get(key); return found ? structuredClone(found) : null; }
  async save(state: RecordState) { this.records.set(state.key, structuredClone(state)); }
  async list(prefix: string) { return [...this.records.values()].filter((r) => r.key.startsWith(prefix)).map((r) => structuredClone(r)); }
  async remove(key: string) { this.records.delete(key); }
}

const DATABASE = 'rpm-migration';
const RECORDS = 'records';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}

// One connection per call, closed when the call is done. The record is saved after every album, and a long
// import would otherwise leave thousands of connections open. close() waits for the transaction to finish.
async function using<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

// The browser's store: one IndexedDB object per import, keyed by account, kind and library.
export const browserRecords: RecordStore = {
  load: (key) =>
    using((db) => new Promise((done, fail) => {
      const request = db.transaction(RECORDS).objectStore(RECORDS).get(key);
      request.onsuccess = () => done((request.result as RecordState | undefined) ?? null);
      request.onerror = () => fail(request.error);
    })),
  save: (state) =>
    using((db) => new Promise<void>((done, fail) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).put(state, state.key);
      tx.oncomplete = () => done();
      tx.onerror = () => fail(tx.error);
    })),
  list: (prefix) =>
    using((db) => new Promise((done, fail) => {
      const request = db.transaction(RECORDS).objectStore(RECORDS).getAll();
      request.onsuccess = () => done((request.result as RecordState[]).filter((r) => r.key.startsWith(prefix)));
      request.onerror = () => fail(request.error);
    })),
  remove: (key) =>
    using((db) => new Promise<void>((done, fail) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).delete(key);
      tx.oncomplete = () => done();
      tx.onerror = () => fail(tx.error);
    })),
};
