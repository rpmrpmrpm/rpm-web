// Which songs and records the listener has marked. A song's mark is a field on its catalogue row, but the
// copies a page holds are taken when the catalogue is read, so the mark is kept apart and asked for by id.
// These are FavoriteMarks and the marks of LibrarySession in the phone app.

import type { Api } from '../api/http';
import type { CloudTrack } from '../api/wire';
import type { CloudAlbum } from './albums';
import { coverSpellings } from './art-key';

const UNIX_EPOCH_SECONDS = 62_135_596_800;

// A favourite's stamp is .NET ticks, which is not the unix seconds of the stamp beside it.
export const utcTicks = (milliseconds: number): number => (milliseconds / 1000 + UNIX_EPOCH_SECONDS) * 10_000_000;

export interface Mark {
  on: boolean;
  at: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export class FavoriteMarks {
  // The marked songs of the catalogue in hand.
  private catalog = new Map<string, number>();

  // What was said here since that catalogue was read. A listing read before a tap cannot undo the tap, so
  // each entry stands until a catalogue says the same thing.
  private readonly mine = new Map<string, Mark>();

  read(tracks: readonly CloudTrack[]) {
    this.catalog = new Map(tracks.filter((track) => track.tags?.favorite === true && track.rpmId).map((track) => [track.rpmId, track.tags?.favoritedAt ?? 0]));
    for (const [id, mark] of this.mine) if (this.catalog.has(id) === mark.on) this.mine.delete(id);
  }

  note(rpmId: string, favorite: boolean, at: number) {
    if (rpmId) this.mine.set(rpmId, { on: favorite, at: favorite ? at : 0 });
  }

  isMarked(rpmId: string): boolean {
    return this.mine.get(rpmId)?.on ?? this.catalog.has(rpmId);
  }

  // To put back when a push is refused. Read before the push: "the other state" is not always the one there was.
  markOf(rpmId: string): Mark {
    const mine = this.mine.get(rpmId);
    if (mine) return mine;
    const at = this.catalog.get(rpmId);
    return at === undefined ? { on: false, at: 0 } : { on: true, at };
  }

  // Newest mark first. Marks of one instant are ordered by name, so the list keeps its order between visits.
  marked(albums: readonly CloudAlbum[]): CloudTrack[] {
    return albums
      .flatMap((album) => album.tracks)
      .filter((track) => this.isMarked(track.rpmId))
      .sort((a, b) => this.markOf(b.rpmId).at - this.markOf(a.rpmId).at || collator.compare(a.title ?? '', b.title ?? ''));
  }

  forget() {
    this.catalog = new Map();
    this.mine.clear();
  }
}

export class Favorites {
  readonly marks = new FavoriteMarks();
  private albumKeys = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly clock: () => number = Date.now,
  ) {}

  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  readTracks(tracks: readonly CloudTrack[]) {
    this.marks.read(tracks);
    this.changed();
  }

  // A failed read keeps the marks already held.
  async readAlbums() {
    try {
      const marks = await this.api.json('cloud/album-marks', (raw) => (raw as { albums?: { albumKey: string; favorite?: boolean }[] }).albums ?? []);
      this.albumKeys = new Set(marks.filter((mark) => mark.favorite).map((mark) => mark.albumKey));
      this.changed();
    } catch {
      // Asked again on the next visit.
    }
  }

  // Shown before the call, and undone if the call fails. catalog/tags drops a push that says only
  // favorite: false, so the mark has a route of its own.
  async mark(track: CloudTrack, on: boolean): Promise<boolean> {
    const before = this.marks.markOf(track.rpmId);
    const at = utcTicks(this.clock());
    this.marks.note(track.rpmId, on, at);
    this.changed();
    try {
      await this.api.call(`cloud/track-mark/${encodeURIComponent(track.rpmId)}`, { method: 'PUT', body: { favorite: on, favoritedAt: on ? at : 0 } });
      return true;
    } catch {
      this.marks.note(track.rpmId, before.on, before.at);
      this.changed();
      return false;
    }
  }

  async isAlbumMarked(album: CloudAlbum): Promise<boolean> {
    return (await coverSpellings(album.tracks)).some((key) => this.albumKeys.has(key));
  }

  async albumsMarked(albums: readonly CloudAlbum[]): Promise<Set<string>> {
    if (this.albumKeys.size === 0) return new Set();
    const marked = await Promise.all(albums.map((album) => this.isAlbumMarked(album)));
    return new Set(albums.filter((_, index) => marked[index]).map((album) => album.key));
  }

  // A mark is stored under the best key. A clear removes it from every key it is stored under.
  async markAlbum(album: CloudAlbum, on: boolean) {
    const spellings = await coverSpellings(album.tracks);
    const keys = on ? spellings.slice(0, 1) : spellings.filter((key) => this.albumKeys.has(key));
    for (const key of keys) {
      this.setAlbumKey(key, on);
      try {
        await this.api.call(`cloud/album-mark/${key}`, { method: 'PUT', body: { favorite: on, favoritedAt: on ? utcTicks(this.clock()) : 0 } });
      } catch {
        this.setAlbumKey(key, !on);
      }
    }
  }

  private setAlbumKey(key: string, on: boolean) {
    if (on) this.albumKeys.add(key);
    else this.albumKeys.delete(key);
    this.changed();
  }

  // The next listener on this browser must not see which songs the last one loved.
  forget() {
    this.marks.forget();
    this.albumKeys = new Set();
    this.changed();
  }
}
