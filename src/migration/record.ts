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

export class MigrationRecord {
  playlistOutcomes: PlaylistOutcome[] = [];

  private constructor(private readonly store: RecordStore, private readonly state: RecordState) {}

  static async open(store: RecordStore, userId: string, library: SourceLibrary): Promise<MigrationRecord> {
    // Playlist files have no library id; the sorted paths of the playlists stand in.
    const libraryKey = library.libraryId || (library.kind === 'playlistfiles' ? await shortHash(library.playlists.map((p) => p.sourceId).sort().join('\n')) : '');
    const key = `${userId}:${library.kind}:${libraryKey}`;
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
      this.state.tracks[id] = { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null, rpmId: null };
      this.state.order.push(id);
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
    const waits = Object.values(this.state.tracks).filter((r) => r.state === 'notimported' && r.attempts < MAX_ATTEMPTS).map((r) => r.nextTry);
    return waits.length > 0 ? Math.min(...waits) : null;
  }

  rows(state: TrackState): (TrackRow & { sourceId: string })[] {
    return this.state.order.map((sourceId) => ({ sourceId, ...this.state.tracks[sourceId]! })).filter((r) => r.state === state);
  }

  // A final state. 'notimported' written here is not tried again.
  note(sourceId: string, state: TrackState, rpmId: string | null = null, reason: string | null = null, detail: string | null = null) {
    const row = this.state.tracks[sourceId];
    if (!row) return;
    Object.assign(row, { state, rpmId: rpmId ?? row.rpmId, reason, detail, attempts: state === 'notimported' ? MAX_ATTEMPTS : row.attempts });
  }

  noteFailure(sourceId: string, reason: string, now: number) {
    const row = this.state.tracks[sourceId];
    if (!row) return;
    row.attempts += 1;
    Object.assign(row, { state: 'notimported', reason, nextTry: now + backoff(row.attempts - 1) });
  }

  retry(sourceIds: readonly string[]) {
    for (const id of sourceIds) {
      const row = this.state.tracks[id];
      if (row?.state === 'notimported') Object.assign(row, { state: 'found', attempts: 0, nextTry: 0, reason: null, detail: null });
    }
  }

  counts() {
    const rows = Object.values(this.state.tracks);
    const imported = rows.filter((r) => r.state === 'imported').length;
    const alreadyInRpm = rows.filter((r) => r.state === 'already').length;
    const notImported = rows.filter((r) => r.state === 'notimported' && r.attempts >= MAX_ATTEMPTS).length;
    return { found: rows.length, imported, alreadyInRpm, notImported, waiting: rows.length - imported - alreadyInRpm - notImported };
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

// The browser's store: one IndexedDB object per import, keyed by account, kind and library.
export const browserRecords: RecordStore = {
  async load(key) {
    const db = await openDatabase();
    return new Promise((done, fail) => {
      const request = db.transaction(RECORDS).objectStore(RECORDS).get(key);
      request.onsuccess = () => done((request.result as RecordState | undefined) ?? null);
      request.onerror = () => fail(request.error);
    });
  },
  async save(state) {
    const db = await openDatabase();
    await new Promise<void>((done, fail) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).put(state, state.key);
      tx.oncomplete = () => done();
      tx.onerror = () => fail(tx.error);
    });
  },
  async list(prefix) {
    const db = await openDatabase();
    return new Promise((done, fail) => {
      const request = db.transaction(RECORDS).objectStore(RECORDS).getAll();
      request.onsuccess = () => done((request.result as RecordState[]).filter((r) => r.key.startsWith(prefix)));
      request.onerror = () => fail(request.error);
    });
  },
};
