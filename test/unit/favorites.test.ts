import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import type { CloudAlbum } from '../../src/library/albums';
import { FavoriteMarks, Favorites, NO_SETTINGS, utcTicks } from '../../src/library/favorites';
import { AlbumRatings } from '../../src/library/ratings';

const song = (rpmId: string, favorite = false, at = 0, title = rpmId): CloudTrack => ({
  rpmId, sha256: 's', relativePath: null, originalSize: 1, title, artist: 'Manu Chao', album: 'Clandestino', addedAt: 1, updatedAt: 1,
  tags: { albumArtist: 'Manu Chao', favorite, favoritedAt: at },
});
const record = (tracks: CloudTrack[]): CloudAlbum => ({ key: 'k', album: 'Clandestino', artist: 'Manu Chao', tracks, addedAt: 1, year: 0 });
const STORED_KEY = 'd90d382db82e7ba38c335b59ae3eaf33';

describe('the marks', () => {
  let marks: FavoriteMarks;
  beforeEach(() => {
    marks = new FavoriteMarks();
  });

  it('are nothing before a catalogue has been read', () => {
    expect(marks.isMarked('a')).toBe(false);
  });

  it('come from a catalogue', () => {
    marks.read([song('a', true, 5), song('b')]);
    expect(marks.isMarked('a')).toBe(true);
    expect(marks.isMarked('b')).toBe(false);
  });

  it('follow a catalogue that no longer marks a song', () => {
    marks.read([song('a', true)]);
    marks.read([song('a')]);
    expect(marks.isMarked('a')).toBe(false);
  });

  it('show a mark made here at once', () => {
    marks.note('a', true, 9);
    expect(marks.isMarked('a')).toBe(true);
  });

  it('show a cleared mark at once', () => {
    marks.read([song('a', true)]);
    marks.note('a', false, 9);
    expect(marks.isMarked('a')).toBe(false);
  });

  it('are not undone by a catalogue read before the tap', () => {
    marks.note('a', true, 9);
    marks.read([song('a')]);
    expect(marks.isMarked('a')).toBe(true);
  });

  it('do not come back from a catalogue read before an unmark', () => {
    marks.read([song('a', true)]);
    marks.note('a', false, 9);
    marks.read([song('a', true)]);
    expect(marks.isMarked('a')).toBe(false);
  });

  it('hand over to a catalogue that has caught up', () => {
    marks.note('a', true, 9);
    marks.read([song('a', true, 20)]);
    expect(marks.markOf('a').at).toBe(20);
    marks.read([song('a')]);
    expect(marks.isMarked('a')).toBe(false);
  });

  it('say what a song was before a push', () => {
    marks.read([song('a', true, 5)]);
    expect(marks.markOf('a')).toEqual({ on: true, at: 5 });
    expect(marks.markOf('b')).toEqual({ on: false, at: 0 });
  });

  it('have no stamp on an unmarked song', () => {
    marks.note('a', false, 9);
    expect(marks.markOf('a').at).toBe(0);
  });

  it('come back newest first, and by name within one instant', () => {
    marks.read([song('old', true, 1), song('new', true, 9), song('b', true, 5, 'Beta'), song('a', true, 5, 'alpha')]);
    const tracks = [song('old'), song('new'), song('b', false, 0, 'Beta'), song('a', false, 0, 'alpha')];
    expect(marks.marked([record(tracks)]).map((track) => track.rpmId)).toEqual(['new', 'a', 'b', 'old']);
  });

  it('leave nothing of either layer after a sign-out', () => {
    marks.read([song('a', true)]);
    marks.note('b', true, 9);
    marks.forget();
    expect(marks.isMarked('a')).toBe(false);
    expect(marks.isMarked('b')).toBe(false);
  });
});

describe('a stamp', () => {
  it('is .NET ticks, not unix seconds', () => {
    expect(utcTicks(0)).toBe(621_355_968_000_000_000);
    expect(utcTicks(1_000)).toBe(621_355_968_010_000_000);
  });
});

describe('marking', () => {
  function stage(fail = false, albums: object[] = []) {
    const call = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (fail) throw new ApiError(500, 'no');
      return new Response(JSON.stringify({ path, options }));
    });
    const api = { call, json: vi.fn(async (_: string, read: (raw: unknown) => unknown) => read({ albums })) };
    return { call, favorites: new Favorites(api as never, () => 0) };
  }

  it('sends a mark through its own route, with its stamp', async () => {
    const { call, favorites } = stage();
    expect(await favorites.mark(song('a'), true)).toBe(true);
    expect(call).toHaveBeenCalledWith('cloud/track-mark/a', { method: 'PUT', body: { favorite: true, favoritedAt: utcTicks(0) } });
  });

  it('clears a mark through the same route, because the tags route drops it', async () => {
    const { call, favorites } = stage();
    favorites.readTracks([song('a', true, 5)]);
    await favorites.mark(song('a', true, 5), false);
    expect(call).toHaveBeenCalledWith('cloud/track-mark/a', { method: 'PUT', body: { favorite: false, favoritedAt: 0 } });
    expect(favorites.marks.isMarked('a')).toBe(false);
  });

  it('puts the mark back when the store refuses', async () => {
    const { favorites } = stage(true);
    favorites.readTracks([song('a', true, 5)]);
    expect(await favorites.mark(song('a', true, 5), false)).toBe(false);
    expect(favorites.marks.markOf('a')).toEqual({ on: true, at: 5 });
  });

  it('marks a record under its best key', async () => {
    const { call, favorites } = stage();
    await favorites.markAlbum(record([song('a')]), true);
    expect(call).toHaveBeenCalledWith(`cloud/album-mark/${STORED_KEY}`, { method: 'PUT', body: { favorite: true, favoritedAt: utcTicks(0) } });
    expect(await favorites.isAlbumMarked(record([song('a')]))).toBe(true);
  });

  it('finds a record marked by another app, and clears it where it is stored', async () => {
    const { call, favorites } = stage(false, [{ albumKey: STORED_KEY, favorite: true }, { albumKey: 'other', favorite: false }]);
    await favorites.readAlbums();
    const album = record([song('a')]);
    expect(await favorites.albumsMarked([album])).toEqual(new Set(['k']));
    await favorites.markAlbum(album, false);
    expect(call).toHaveBeenCalledWith(`cloud/album-mark/${STORED_KEY}`, { method: 'PUT', body: { favorite: false, favoritedAt: 0 } });
    expect(await favorites.isAlbumMarked(album)).toBe(false);
  });

  it('puts a record back when the store refuses', async () => {
    const { favorites } = stage(true);
    await favorites.markAlbum(record([song('a')]), true);
    expect(await favorites.isAlbumMarked(record([song('a')]))).toBe(false);
  });

  it('reads a record\'s levelling and series, and only from a row some device set them on', async () => {
    const { favorites } = stage(false, [
      { albumKey: STORED_KEY, favorite: true, normalize: false, series: ' Now ', seriesVolume: '43', settingsAt: 9 },
      { albumKey: 'other', series: 'Ignored', settingsAt: 0 },
    ]);
    await favorites.readAlbums();
    expect(await favorites.settingsOf(record([song('a')]))).toEqual({ normalize: false, series: 'Now', seriesVolume: '43' });
    expect(favorites.seriesNames()).toEqual(['Now']);
  });

  it('reads a record nobody set anything on as the defaults', async () => {
    const { favorites } = stage(false, [{ albumKey: STORED_KEY, favorite: true }]);
    await favorites.readAlbums();
    expect(await favorites.settingsOf(record([song('a')]))).toEqual(NO_SETTINGS);
  });

  it('saves the three settings together under the best key, and drops a volume without a series', async () => {
    const { call, favorites } = stage();
    await favorites.saveSettings(record([song('a')]), { normalize: true, series: '  ', seriesVolume: '3' });
    expect(call).toHaveBeenCalledWith(`cloud/album-mark/${STORED_KEY}/settings`, { method: 'PUT', body: { normalize: true, series: null, seriesVolume: null } });
    expect(await favorites.settingsOf(record([song('a')]))).toEqual({ normalize: true, series: null, seriesVolume: null });
  });

  it('lets a refused save through, so the window can say so', async () => {
    const { favorites } = stage(true);
    await expect(favorites.saveSettings(record([song('a')]), NO_SETTINGS)).rejects.toThrow();
  });

  it('keeps the marks it holds when a read fails', async () => {
    const api = { call: vi.fn(), json: vi.fn(async () => { throw new ApiError(500, 'no'); }) };
    const favorites = new Favorites(api as never, () => 0);
    await expect(favorites.readAlbums()).resolves.toBeUndefined();
  });
});

describe('the stars of a record', () => {
  const held = new Map<string, string>();
  const shelf = () => ({ getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), removeItem: (key: string) => void held.delete(key) });
  beforeEach(() => held.clear());

  it('are kept by account and cover key, as the phone apps file them', async () => {
    await new AlbumRatings(shelf).rate(record([song('a')]), 4, 'user');
    expect(held.get(`rpm.albumRating.user|${STORED_KEY}`)).toBe('4');
    expect(await new AlbumRatings(shelf).stars(record([song('a')]), 'user')).toBe(4);
    expect(await new AlbumRatings(shelf).stars(record([song('a')]), 'someone else')).toBe(0);
  });

  it('stop at five', async () => {
    await new AlbumRatings(shelf).rate(record([song('a')]), 9, 'user');
    expect(await new AlbumRatings(shelf).stars(record([song('a')]), 'user')).toBe(5);
  });

  it('are cleared by zero', async () => {
    const ratings = new AlbumRatings(shelf);
    await ratings.rate(record([song('a')]), 3, 'user');
    await ratings.rate(record([song('a')]), 0, 'user');
    expect(held.size).toBe(0);
  });

  it('read as none where storage is blocked, and do not throw', async () => {
    const blocked = new AlbumRatings(() => {
      throw new Error('blocked');
    });
    await expect(blocked.rate(record([song('a')]), 3, 'user')).resolves.toBeUndefined();
    expect(await blocked.stars(record([song('a')]), 'user')).toBe(0);
  });
});
