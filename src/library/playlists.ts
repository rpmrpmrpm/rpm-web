// The account's playlists. Every change reads the stored list again and writes on the condition that
// nobody changed it since, because a page can stay open for hours and another device may have moved on.
// When the store refuses, it hands back what it holds, and the same change is made to that.

import { ApiError, type Api } from '../api/http';

export interface CloudPlaylist {
  playlistId: string;
  name: string;
  trackIds: string[];
  folder: string[];
  updatedAt: number;
}

export interface GeneratedList {
  kind: string;
  title: string | null;
  trackIds: string[];
}

const TRIES = 3;

export class PlaylistGone extends Error {}

type Change = (playlist: CloudPlaylist) => Pick<CloudPlaylist, 'name' | 'trackIds'>;

export class Playlists {
  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly mint: () => string = () => crypto.randomUUID(),
  ) {}

  list(): Promise<CloudPlaylist[]> {
    return this.api.json('cloud/playlists', (raw) => (raw as { playlists?: CloudPlaylist[] }).playlists ?? []);
  }

  // What the desktop cut for this account. An account with no desktop has none, which is not a failure.
  async generated(): Promise<GeneratedList[]> {
    try {
      return await this.api.json('cloud/moodlists', (raw) => (raw as { lists?: GeneratedList[] }).lists ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  private put(id: string, name: string, trackIds: string[], folder: string[], ifUnchangedSince: number): Promise<Response> {
    return this.api.call(`cloud/playlist/${encodeURIComponent(id)}`, { method: 'PUT', body: { name, trackIds, folder, ifUnchangedSince } });
  }

  async create(name: string, trackIds: string[], folder: string[] = []): Promise<CloudPlaylist> {
    const playlist = { playlistId: this.mint(), name: name.trim(), trackIds, folder, updatedAt: 0 };
    // Zero says nothing may be stored under this id yet.
    await this.put(playlist.playlistId, playlist.name, trackIds, folder, 0);
    return playlist;
  }

  private async change(id: string, make: Change): Promise<void> {
    let current = (await this.list()).find((playlist) => playlist.playlistId === id);
    if (!current) throw new PlaylistGone();

    for (let attempt = 1; ; attempt++) {
      const next = make(current);
      try {
        await this.put(id, next.name, next.trackIds, current.folder, current.updatedAt);
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || attempt >= TRIES) throw error;
        current = (await this.list()).find((playlist) => playlist.playlistId === id);
        if (!current) throw new PlaylistGone();
      }
    }
  }

  // A track already there is not added again.
  add(id: string, trackIds: readonly string[]): Promise<void> {
    return this.change(id, (playlist) => {
      const have = new Set(playlist.trackIds);
      return { name: playlist.name, trackIds: [...playlist.trackIds, ...trackIds.filter((rpmId) => !have.has(rpmId))] };
    });
  }

  // One copy, the one at this place. A track can be on a playlist twice.
  removeAt(id: string, rpmId: string, place: number): Promise<void> {
    return this.change(id, (playlist) => {
      const at = playlist.trackIds[place] === rpmId ? place : playlist.trackIds.indexOf(rpmId);
      return { name: playlist.name, trackIds: playlist.trackIds.filter((_, index) => index !== at) };
    });
  }

  rename(id: string, name: string): Promise<void> {
    return this.change(id, (playlist) => ({ name: name.trim(), trackIds: playlist.trackIds }));
  }

  async remove(id: string): Promise<void> {
    await this.api.call(`cloud/playlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
