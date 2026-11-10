// The shared sample libraries (copied from the rpm repo by scripts/sync_fixtures.py there) and the
// comparison with their expected results, the same one the desktop's tests make.

import { readFileSync } from 'node:fs';

import type { SourceLibrary } from '../../src/migration/model';

const root = new URL('../fixtures/migration/', import.meta.url);

export const fixture = (path: string): string => readFileSync(new URL(path, root), 'utf8');
export const fixtureBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(path, root)));
export const fixtureJson = (path: string): unknown => JSON.parse(fixture(path));

const date = (value: string | Date | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const at = typeof value === 'string' ? new Date(value.replace(/(\.\d{3})\d+/, '$1')) : value;
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

interface ExpectedTrack {
  file: { local?: string; remote?: string; extension?: string; size?: number };
  lastPlayed: string | null;
  added: string | null;
  [field: string]: unknown;
}

// The expected JSON with its dates written the one way the comparison writes them.
export function expected(name: string): unknown {
  const raw = fixtureJson(`expected/${name}.json`) as { tracks: ExpectedTrack[]; [field: string]: unknown };
  return {
    ...raw,
    tracks: raw.tracks.map((t) => ({
      ...t,
      file: t.file.local !== undefined ? { local: t.file.local } : { remote: t.file.remote, extension: t.file.extension, size: t.file.size },
      lastPlayed: date(t.lastPlayed),
      added: date(t.added),
    })),
  };
}

// A reader's library in the expected JSON's shape.
export function shape(library: SourceLibrary): unknown {
  return {
    kind: library.kind,
    libraryId: library.libraryId,
    name: library.name,
    tracks: library.tracks.map((t) => ({
      sourceId: t.sourceId,
      file: t.file.kind === 'local' ? { local: t.file.path } : { remote: t.file.key, extension: t.file.extension, size: t.file.size },
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumArtist: t.albumArtist,
      trackNumber: t.trackNumber,
      discNumber: t.discNumber,
      durationSeconds: t.durationSeconds,
      sizeBytes: t.sizeBytes,
      rating: t.rating,
      favorite: t.favorite,
      plays: t.plays,
      lastPlayed: date(t.lastPlayed),
      added: date(t.added),
    })),
    playlists: library.playlists.map((p) => ({
      sourceId: p.sourceId,
      name: p.name,
      folder: p.folder,
      smart: p.smart,
      trackIds: p.trackIds,
      unresolved: p.unresolved,
    })),
    skipped: library.skipped.map((s) => ({ what: s.what, reasonKey: s.reasonKey })),
  };
}
