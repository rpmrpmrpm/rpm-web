// The account's playlists. Every change reads the stored list again and writes on the condition that
// nobody changed it since, because a page can stay open for hours and another device may have moved on.
// When the store refuses, it hands back what it holds, and the same change is made to that.

import { ApiError, type Api } from '../api/http';
import type { Transfers } from '../import/importer';

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

type Change = (playlist: CloudPlaylist) => Pick<CloudPlaylist, 'name' | 'trackIds'> & { folder?: string[] };

const count = (ids: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

// One playlist's running order when two heads both changed it. PlaylistMerge on the desktop, counted and not
// set-based, because a playlist may hold a song twice on purpose. A song's count is what was published, plus the
// larger of the two sides' additions, minus the larger of their removals. Two heads putting a song in made one
// change, not two. With no ancestor nothing can be shown to have been removed, so nothing is. The store's order
// stands, because every other head is already looking at it, and what this side added goes after it.
export function mergeSongs(ancestor: readonly string[] | null, mine: readonly string[], theirs: readonly string[]): string[] {
  if (ancestor) {
    if (sameList(ancestor, mine)) return [...theirs];
    if (sameList(ancestor, theirs)) return [...mine];
  }

  const was = count(ancestor ?? []);
  const here = count(mine);
  const there = count(theirs);
  const want = new Map<string, number>();

  for (const id of new Set([...here.keys(), ...there.keys(), ...was.keys()])) {
    const before = was.get(id) ?? 0;
    const ours = here.get(id) ?? 0;
    const others = there.get(id) ?? 0;
    const added = Math.max(0, ours - before, others - before);
    const removed = ancestor ? Math.max(0, before - ours, before - others) : 0;
    want.set(id, Math.max(0, before + added - removed));
  }

  const merged: string[] = [];
  const taken = new Map<string, number>();
  for (const id of [...theirs, ...mine]) {
    const already = taken.get(id) ?? 0;
    if (already >= (want.get(id) ?? 0)) continue;
    taken.set(id, already + 1);
    merged.push(id);
  }
  return merged;
}

const samePath = (a: readonly string[], b: readonly string[]) => sameList(a, b);

// A grid shows one folder at a time. A folder is the path on the playlists in it, so one with nothing in it exists
// only on the screen it was made on.
export const listsIn = (lists: readonly CloudPlaylist[], path: readonly string[]) => lists.filter((list) => samePath(list.folder, path));

export function foldersIn(lists: readonly CloudPlaylist[], path: readonly string[], made: readonly (readonly string[])[] = []): string[] {
  const names = new Set<string>();
  for (const folder of [...lists.map((list) => list.folder), ...made]) {
    if (folder.length > path.length && path.every((name, index) => folder[index] === name)) names.add(folder[path.length]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export class Playlists {
  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly transfers: Pick<Transfers, 'put'> = { put: async () => {} },
    private readonly mint: () => string = () => crypto.randomUUID(),
  ) {}

  private readonly pictures = new Map<string, Promise<string | null>>();

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
        await this.put(id, next.name, next.trackIds, next.folder ?? current.folder, current.updatedAt);
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

  // A new running order. shown is the list the order was made from, so a song the phone added meanwhile stays.
  reorder(id: string, shown: readonly string[], mine: readonly string[]): Promise<void> {
    return this.change(id, (playlist) => ({ name: playlist.name, trackIds: mergeSongs(shown, mine, playlist.trackIds) }));
  }

  // Files a playlist in a folder.
  refile(id: string, folder: string[]): Promise<void> {
    return this.change(id, (playlist) => ({ name: playlist.name, trackIds: playlist.trackIds, folder }));
  }

  rename(id: string, name: string): Promise<void> {
    return this.change(id, (playlist) => ({ name: name.trim(), trackIds: playlist.trackIds }));
  }

  async remove(id: string): Promise<void> {
    await this.api.call(`cloud/playlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // The picture a list wears, or null. Every failure is no picture: the list then wears its records. One question
  // per list, so a wall that scrolls does not ask again.
  picture(id: string): Promise<string | null> {
    let asked = this.pictures.get(id);
    if (!asked) {
      asked = this.api
        .json(`cloud/playlist-art/${encodeURIComponent(id)}`, (raw) => (raw as { url?: string | null }).url ?? null)
        .catch(() => null);
      this.pictures.set(id, asked);
    }
    return asked;
  }

  async choosePicture(id: string, bytes: Uint8Array, mime: string): Promise<void> {
    const slot = await this.api.json(`cloud/playlist-art/${encodeURIComponent(id)}?contentType=${encodeURIComponent(mime)}`, (raw) => raw as { url: string }, { method: 'POST' });
    await this.transfers.put(slot.url, bytes, { contentType: mime });
    this.pictures.delete(id);
  }

  async removePicture(id: string): Promise<void> {
    await this.api.call(`cloud/playlist-art/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.pictures.delete(id);
  }
}
