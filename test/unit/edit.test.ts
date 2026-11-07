import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import type { CloudAlbum } from '../../src/library/albums';
import { coverKeyForTrack, discKeyForTrack } from '../../src/library/art-key';
import { CatalogEdits, pushFor } from '../../src/library/edit';

const song = (rpmId: string, tags: CloudTrack['tags'] = { albumArtist: 'Manu Chao', year: 1998, trackNumber: 1, genre: 'Latin' }): CloudTrack => ({
  rpmId, sha256: 's', relativePath: null, originalSize: 1, title: 'Bongo Bong', artist: 'Manu Chao', album: 'Clandestino', addedAt: 1, updatedAt: 1, tags,
});
const record = (tracks: CloudTrack[]): CloudAlbum => ({ key: 'k', album: 'Clandestino', artist: 'Manu Chao', tracks, addedAt: 1, year: 1998 });

describe('what a push carries', () => {
  it('is only what changed', () => {
    expect(pushFor(song('a'), { title: 'New', artist: 'Manu Chao', year: 1998, genre: 'Rock' })).toEqual({ rpmId: 'a', title: 'New', tags: { genre: 'Rock' } });
  });

  it('is nothing when nothing changed', () => {
    expect(pushFor(song('a'), { title: 'Bongo Bong', album: 'Clandestino', year: 1998 })).toBeNull();
  });

  it('reads a blank as "not being changed", because the store cannot clear a field', () => {
    expect(pushFor(song('a'), { title: '   ', genre: '', year: 0 })).toBeNull();
  });

  it('trims what is typed', () => {
    expect(pushFor(song('a'), { title: '  New  ' })).toEqual({ rpmId: 'a', title: 'New' });
  });

  it('can set a tag on a row that has no tags at all', () => {
    expect(pushFor(song('a', null), { composer: 'Chao', trackNumber: 2 })).toEqual({ rpmId: 'a', tags: { composer: 'Chao', trackNumber: 2 } });
  });
});

describe('saving', () => {
  function stage(pictures: Record<string, { bytes: Uint8Array; mime: string }> = {}, marked = false) {
    const pushed: { items: { rpmId: string }[] }[] = [];
    const posted: string[] = [];
    const api = {
      call: vi.fn(async (_path: string, options: { body: { items: { rpmId: string }[] } }) => {
        pushed.push(options.body);
        return new Response('{}');
      }),
      json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => {
        posted.push(path);
        return read({ url: `slot/${path}` });
      }),
    };
    const covers = { pictureAt: vi.fn(async (key: string) => pictures[key] ?? null), reread: vi.fn() };
    const transfers = { put: vi.fn(async () => {}) };
    const favorites = { isAlbumMarked: vi.fn(async () => marked), markAlbum: vi.fn(async () => {}) };
    return { pushed, posted, covers, transfers, favorites, edits: new CatalogEdits(api as never, covers as never, transfers, favorites as never) };
  }

  it('pushes every changed track, and says how many', async () => {
    const { pushed, edits } = stage();
    expect(await edits.apply([song('a'), song('b')], { genre: 'Rock' })).toBe(2);
    expect(pushed[0]!.items.map((item) => item.rpmId)).toEqual(['a', 'b']);
  });

  it('sends nothing when nothing changed', async () => {
    const { pushed, edits } = stage();
    expect(await edits.apply([song('a')], { genre: 'Latin' })).toBe(0);
    expect(pushed).toEqual([]);
  });

  it('keeps to the size of push the store takes', async () => {
    const { pushed, edits } = stage();
    await edits.apply(Array.from({ length: 450 }, (_, index) => song(`t${index}`)), { genre: 'Rock' });
    expect(pushed.map((push) => push.items.length)).toEqual([200, 200, 50]);
  });

  it('lets a refusal through, so the window can say so', async () => {
    const api = { call: vi.fn(async () => { throw new ApiError(500, 'no'); }), json: vi.fn() };
    const edits = new CatalogEdits(api as never, {} as never, { put: vi.fn() }, {} as never);
    await expect(edits.apply([song('a')], { genre: 'Rock' })).rejects.toThrow();
  });

  it('carries the cover and the disc label to the keys a new name gives', async () => {
    const before = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const after = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino Deluxe');
    const discBefore = await discKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const discAfter = await discKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino Deluxe');
    const { posted, transfers, covers, edits } = stage({ [before]: { bytes: new Uint8Array([1]), mime: 'image/jpeg' }, [discBefore]: { bytes: new Uint8Array([2]), mime: 'image/png' } });

    await edits.apply([song('a')], { album: 'Clandestino Deluxe' }, record([song('a')]));

    expect(posted).toEqual([`cloud/art/${after}?contentType=image%2Fjpeg`, `cloud/art/${discAfter}?contentType=image%2Fpng`]);
    expect(transfers.put).toHaveBeenCalledTimes(2);
    expect(covers.reread).toHaveBeenCalled();
  });

  it('moves nothing when the names stay the same', async () => {
    const { covers, edits } = stage();
    await edits.apply([song('a')], { genre: 'Rock' }, record([song('a')]));
    expect(covers.pictureAt).not.toHaveBeenCalled();
  });

  it('takes the heart of a favourite record with it', async () => {
    const { favorites, edits } = stage({}, true);
    await edits.apply([song('a')], { album: 'Clandestino Deluxe' }, record([song('a')]));
    expect(favorites.markAlbum).toHaveBeenCalledTimes(1);
    const [renamed, on] = favorites.markAlbum.mock.calls[0] as unknown as [CloudAlbum, boolean];
    expect(on).toBe(true);
    expect(renamed.tracks[0]!.album).toBe('Clandestino Deluxe');
  });

  it('keeps the new names when a picture will not follow', async () => {
    const before = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const { transfers, edits } = stage({ [before]: { bytes: new Uint8Array([1]), mime: 'image/jpeg' } });
    transfers.put.mockRejectedValueOnce(new Error('no'));
    await expect(edits.apply([song('a')], { album: 'New' }, record([song('a')]))).resolves.toBe(1);
  });
});
