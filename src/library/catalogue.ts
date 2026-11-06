// The library: read from the store, kept in this browser, and turned into albums.

import type { CloudClient } from '../api/cloud';
import type { CloudTrack } from '../api/wire';
import { groupAlbums, sortAlbums, type AlbumOrdering, type CloudAlbum } from './albums';
import type { CatalogueStore } from './store';

// The listing has no changed-since and is the largest per-user cost, so it is read when the app opens,
// after an import, and when the tab returns after at least this long. Never on a timer.
const READ_AGAIN_AFTER_MS = 10 * 60 * 1000;

export type CatalogueState =
  | 'opening' // nothing to show yet
  | 'reading' // the first read, with no copy in this browser
  | 'ready'
  | 'failed'; // the store could not be read and there is no copy

export class Catalogue {
  tracks: CloudTrack[] = [];
  albums: CloudAlbum[] = [];
  state: CatalogueState = 'opening';
  ordering: AlbumOrdering = 'Artist';
  // A refresh failed while a copy is on screen. The copy stays, with a way to try again.
  stale = false;
  read = 0;

  private userId = '';
  private readAt = 0;
  private reading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly cloud: Pick<CloudClient, 'list'>,
    private readonly store: CatalogueStore,
    private readonly now: () => number = Date.now,
    // Runs when a whole list is in, before anything is shown from it.
    private readonly fresh: () => void = () => {},
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  private show(tracks: CloudTrack[]) {
    this.tracks = tracks;
    this.albums = sortAlbums(groupAlbums(tracks), this.ordering);
  }

  async open(userId: string): Promise<void> {
    this.userId = userId;
    this.tracks = [];
    this.albums = [];
    this.stale = false;
    this.state = 'opening';
    this.changed();

    const kept = await this.store.read(userId);
    if (kept) {
      this.show(kept);
      this.state = 'ready';
    } else {
      this.state = 'reading';
    }
    this.changed();

    await this.refresh();
  }

  refresh(): Promise<void> {
    this.reading ??= this.readAll().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async readAll(): Promise<void> {
    const userId = this.userId;
    this.read = 0;
    try {
      const tracks = await this.cloud.list((read) => {
        this.read = read;
        if (this.state === 'reading') this.changed();
      });

      // Signed out or changed account while reading.
      if (userId !== this.userId) return;

      this.fresh();
      this.show(tracks);
      this.state = 'ready';
      this.stale = false;
      this.readAt = this.now();
      this.changed();
      await this.store.write(userId, tracks);
    } catch {
      if (userId !== this.userId) return;
      // A failed read is an error on screen. It is never an empty library, and never a part of one.
      if (this.tracks.length > 0 || this.state === 'ready') this.stale = true;
      else this.state = 'failed';
      this.changed();
    }
  }

  // The id this account stores this audio under, if any.
  idOf(sha256: string): string | undefined {
    return this.tracks.find((track) => track.sha256 === sha256)?.rpmId;
  }

  focused() {
    if (this.state === 'ready' && this.now() - this.readAt >= READ_AGAIN_AFTER_MS) void this.refresh();
  }

  setOrdering(ordering: AlbumOrdering) {
    this.ordering = ordering;
    this.albums = sortAlbums(this.albums, ordering);
    this.changed();
  }

  close() {
    this.userId = '';
    this.tracks = [];
    this.albums = [];
    this.state = 'opening';
    this.changed();
  }
}
