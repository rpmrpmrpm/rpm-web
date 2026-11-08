import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import type { CloudAlbum } from '../../src/library/albums';
import { coverKeyForTrack, discKeyForTrack } from '../../src/library/art-key';
import { CatalogEdits, changesSidecar, mergeSidecar, pushFor, tagsFor, type TrackEdit } from '../../src/library/edit';
import type { TagSet } from '../../src/library/tag-fields';

const song = (rpmId: string, tags: CloudTrack['tags'] = { albumArtist: 'Manu Chao', year: 1998, trackNumber: 1, genre: 'Latin' }): CloudTrack => ({
  rpmId, sha256: 's', relativePath: null, originalSize: 1, title: 'Bongo Bong', artist: 'Manu Chao', album: 'Clandestino', addedAt: 1, updatedAt: 1, tags,
});
const record = (tracks: CloudTrack[]): CloudAlbum => ({ key: 'k', album: 'Clandestino', artist: 'Manu Chao', tracks, addedAt: 1, year: 1998 });
const unmarked = { on: false, at: 0 };
const asRead = (track: CloudTrack, sidecar: TagSet | null = null) => tagsFor(track, sidecar);
const edited = (track: CloudTrack, change: TagSet, sidecar: TagSet | null = null): TrackEdit => {
  const before = asRead(track, sidecar);
  const after = { ...before, ...change };
  for (const [key, value] of Object.entries(change)) if (value === '' || value === 0) delete after[key];
  return { track, before, after };
};

describe('what a window reads', () => {
  it('is the sidecar with the row over it, and never the cover', () => {
    const tags = tagsFor(song('a'), { Title: 'Old title', Conductor: 'Someone', Art: 'AAAA', ArtMime: 'image/png', RelativePath: 'x' });
    expect(tags).toMatchObject({ Title: 'Bongo Bong', Conductor: 'Someone', Genre: 'Latin', Year: 1998, AlbumArtist: 'Manu Chao' });
    expect(tags.Art).toBeUndefined();
    expect(tags.ArtMime).toBeUndefined();
  });

  it('is the row alone for a track with no sidecar', () => {
    expect(tagsFor(song('a'), null)).toEqual({ Title: 'Bongo Bong', Artist: 'Manu Chao', Album: 'Clandestino', AlbumArtist: 'Manu Chao', Year: 1998, TrackNumber: 1, Genre: 'Latin' });
  });
});

describe('what a push carries', () => {
  it('is only what changed', () => {
    const track = song('a');
    expect(pushFor(track, { ...asRead(track), Title: 'New', Genre: 'Rock' }, unmarked)).toEqual({ rpmId: 'a', title: 'New', tags: { genre: 'Rock', favorite: false, favoritedAt: 0 } });
  });

  it('is nothing when nothing changed', () => {
    const track = song('a');
    expect(pushFor(track, asRead(track), unmarked)).toBeNull();
  });

  it('keeps the favourite mark, because the store writes the mark with every set of tags', () => {
    const track = song('a');
    expect(pushFor(track, { ...asRead(track), Year: 1999 }, { on: true, at: 42 })?.tags).toEqual({ year: 1999, favorite: true, favoritedAt: 42 });
  });

  it('names an emptied field in the clear list, and sends no mark for a clear alone', () => {
    const track = song('a');
    const { Genre: _genre, Year: _year, ...rest } = asRead(track);
    expect(pushFor(track, rest, unmarked)).toEqual({ rpmId: 'a', clear: ['genre', 'year'] });
  });

  it('never empties a name: a blank title is not sent', () => {
    const track = song('a');
    expect(pushFor(track, { ...asRead(track), Title: '  ' }, unmarked)).toBeNull();
  });

  it('trims what is typed', () => {
    const track = song('a');
    expect(pushFor(track, { ...asRead(track), Title: '  New  ' }, unmarked)).toEqual({ rpmId: 'a', title: 'New' });
  });

  it('can set a tag on a row that has no tags at all', () => {
    const track = song('a', null);
    expect(pushFor(track, { ...asRead(track), Composers: 'Chao', TrackNumber: 2 }, unmarked)).toEqual({ rpmId: 'a', tags: { trackNumber: 2, composer: 'Chao', favorite: false, favoritedAt: 0 } });
  });

  it('carries the pressing and the release type, which the row also keeps', () => {
    const track = song('a');
    expect(pushFor(track, { ...asRead(track), CatalogNumber: 'CAT 1', ReleaseType: 'Live', Advisory: 1 }, unmarked)?.tags).toEqual({
      advisory: 1, catno: 'CAT 1', releaseType: 'Live', favorite: false, favoritedAt: 0,
    });
  });
});

describe('the sidecar an edit writes', () => {
  it('writes what the window changed, emptied fields included, and keeps the rest', () => {
    const sidecar = { Version: 5, RelativePath: 'a/b.flac', RpmId: 'a', Title: 'Old', Conductor: 'Gone', Favorite: true, Art: 'AAAA', ArtMime: 'image/jpeg', Channels: 2 };
    const before = { Title: 'Old', Conductor: 'Gone' };
    const merged = mergeSidecar(sidecar, before, { Title: 'New', Lyrics: 'La la', Soloists: 'A (soprano)' }, undefined);
    expect(merged).toEqual({ Version: 5, RelativePath: 'a/b.flac', RpmId: 'a', Title: 'New', Conductor: null, Lyrics: 'La la', Soloists: 'A (soprano)', Favorite: true, Art: 'AAAA', ArtMime: 'image/jpeg', Channels: 2 });
  });

  it('says an emptied field is empty rather than leaving it out, with zero for a number', () => {
    // A computer that holds the file reads a missing field as "not known" and keeps its own value.
    const merged = mergeSidecar({ Year: 1997, Advisory: 1, Bpm: 120, Genre: 'Rock' }, { Year: 1997, Advisory: 1, Bpm: 120, Genre: 'Rock' }, {}, undefined);
    expect(merged).toEqual({ Year: 0, Advisory: 0, Bpm: 0, Genre: null });
    expect(JSON.parse(JSON.stringify(merged))).toEqual(merged);
  });

  it('leaves a field the window did not change as the sidecar has it now', () => {
    const now = { Title: 'A', Publisher: 'Changed on a phone' };
    expect(mergeSidecar(now, { Title: 'A', Publisher: 'Island' }, { Title: 'B', Publisher: 'Island' }, undefined)).toEqual({ Title: 'B', Publisher: 'Changed on a phone' });
    expect(mergeSidecar(now, { Title: 'A' }, { Title: 'A' }, undefined)).toEqual(now);
  });

  it('puts a new cover in, or takes it out', () => {
    const sidecar = { Title: 'A', Art: 'AAAA', ArtMime: 'image/jpeg' };
    expect(mergeSidecar(sidecar, { Title: 'A' }, { Title: 'A' }, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })).toMatchObject({ Art: 'AQID', ArtMime: 'image/png' });
    const without = mergeSidecar(sidecar, { Title: 'A' }, { Title: 'A' }, 'remove');
    expect(without).toHaveProperty('Art', null);
    expect(without).toHaveProperty('ArtMime', null);
  });

  it('is only written when the edit changes what it holds', () => {
    expect(changesSidecar({ Title: 'A', Year: 1 }, { Title: 'A', Year: 1 })).toBe(false);
    expect(changesSidecar({ Title: 'A' }, { Title: 'A', Conductor: 'B' })).toBe(true);
    expect(changesSidecar({ Title: 'A', Lyrics: 'x' }, { Title: 'A' })).toBe(true);
  });
});

describe('saving', () => {
  function stage(pictures: Record<string, { bytes: Uint8Array; mime: string }> = {}, marked = false, sidecars: Record<string, TagSet | null> = {}) {
    const pushed: { items: { rpmId: string }[] }[] = [];
    const posted: string[] = [];
    const deleted: string[] = [];
    const api = {
      call: vi.fn(async (path: string, options: { method?: string; body: { items: { rpmId: string }[] } }) => {
        if (options.method === 'DELETE') deleted.push(path);
        else pushed.push(options.body);
        return new Response('{}');
      }),
      json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => {
        posted.push(path);
        return read({ url: `slot/${path}` });
      }),
    };
    const covers = { pictureAt: vi.fn(async (key: string) => pictures[key] ?? null), reread: vi.fn() };
    const transfers = { put: vi.fn(async () => {}) };
    const favorites = { isAlbumMarked: vi.fn(async () => marked), markAlbum: vi.fn(async () => {}), marks: { markOf: vi.fn(() => ({ on: true, at: 7 })) } };
    const store = {
      read: vi.fn(async (rpmId: string) => (rpmId in sidecars ? sidecars[rpmId]! : { RpmId: rpmId, Title: 'Bongo Bong' })),
      write: vi.fn(async () => {}),
    };
    return { pushed, posted, deleted, covers, transfers, favorites, store, edits: new CatalogEdits(api as never, covers as never, transfers, favorites as never, store) };
  }

  it('pushes every changed track with its mark, and says how many', async () => {
    const { pushed, edits } = stage();
    expect(await edits.save([edited(song('a'), { Genre: 'Rock' }), edited(song('b'), { Genre: 'Rock' })])).toBe(2);
    expect(pushed[0]!.items).toEqual([
      { rpmId: 'a', tags: { genre: 'Rock', favorite: true, favoritedAt: 7 }, sidecar: true },
      { rpmId: 'b', tags: { genre: 'Rock', favorite: true, favoritedAt: 7 }, sidecar: true },
    ]);
  });

  it('writes the sidecars before it pushes the rows that name them', async () => {
    const { pushed, store, edits } = stage();
    const order: string[] = [];
    store.write.mockImplementation(async () => {
      order.push(`sidecar with ${pushed.length} pushes sent`);
    });
    await edits.save([edited(song('a'), { Genre: 'Rock' })]);
    expect(order).toEqual(['sidecar with 0 pushes sent']);
    expect(pushed).toHaveLength(1);
  });

  it('does not say a sidecar was rewritten for a track that has none', async () => {
    const { pushed, edits } = stage({}, false, { a: null });
    await edits.save([edited(song('a'), { Genre: 'Rock' })]);
    expect(pushed[0]!.items).toEqual([{ rpmId: 'a', tags: { genre: 'Rock', favorite: true, favoritedAt: 7 } }]);
  });

  it('sends nothing when nothing changed', async () => {
    const { pushed, store, edits } = stage();
    expect(await edits.save([edited(song('a'), {})])).toBe(0);
    expect(pushed).toEqual([]);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('writes a field the row does not hold into the sidecar, and tells the row it was rewritten', async () => {
    const { pushed, store, edits } = stage();
    expect(await edits.save([edited(song('a'), { Conductor: 'Karajan' })])).toBe(1);
    expect(pushed).toEqual([{ items: [{ rpmId: 'a', sidecar: true }] }]);
    expect(store.write).toHaveBeenCalledWith('a', expect.objectContaining({ RpmId: 'a', Conductor: 'Karajan' }));
  });

  it('reads the sidecar again before writing it, so a change made since the window opened is kept', async () => {
    const { store, edits } = stage({}, false, { a: { RpmId: 'a', Favorite: true, Title: 'Bongo Bong' } });
    await edits.save([edited(song('a'), { Conductor: 'Karajan' })]);
    expect(store.write).toHaveBeenCalledWith('a', expect.objectContaining({ Favorite: true }));
  });

  it('writes no sidecar for a track that has none', async () => {
    const { store, edits } = stage({}, false, { a: null });
    await edits.save([edited(song('a'), { Conductor: 'Karajan' })]);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('keeps to the size of push the store takes', async () => {
    const { pushed, edits } = stage();
    await edits.save(Array.from({ length: 450 }, (_, index) => edited(song(`t${index}`), { Genre: 'Rock' })));
    expect(pushed.map((push) => push.items.length)).toEqual([200, 200, 50]);
  });

  it('lets a refusal through, so the window can say so', async () => {
    const api = { call: vi.fn(async () => { throw new ApiError(500, 'no'); }), json: vi.fn() };
    const edits = new CatalogEdits(api as never, {} as never, { put: vi.fn() }, { marks: { markOf: () => unmarked } } as never, { read: vi.fn(), write: vi.fn() });
    await expect(edits.save([edited(song('a'), { Genre: 'Rock' })])).rejects.toThrow();
  });

  it('carries the cover and the disc label to the keys a new name gives', async () => {
    const before = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const after = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino Deluxe');
    const discBefore = await discKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const discAfter = await discKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino Deluxe');
    const { posted, transfers, covers, edits } = stage({ [before]: { bytes: new Uint8Array([1]), mime: 'image/jpeg' }, [discBefore]: { bytes: new Uint8Array([2]), mime: 'image/png' } });

    await edits.save([edited(song('a'), { Album: 'Clandestino Deluxe' })], record([song('a')]));

    expect(posted.filter((path) => path.startsWith('cloud/art/'))).toEqual([`cloud/art/${after}?contentType=image%2Fjpeg`, `cloud/art/${discAfter}?contentType=image%2Fpng`]);
    expect(transfers.put).toHaveBeenCalledTimes(2);
    expect(covers.reread).toHaveBeenCalled();
  });

  it('puts a new cover under the record key and into every sidecar, and takes the old one away when asked', async () => {
    const key = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const { posted, store, transfers, edits } = stage();
    await edits.save([edited(song('a'), {}), edited(song('b'), {})], record([song('a'), song('b')]), { cover: { bytes: new Uint8Array([9]), mime: 'image/png' } });
    expect(posted).toContain(`cloud/art/${key}?contentType=image%2Fpng`);
    expect(transfers.put).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledTimes(2);
    expect(store.write).toHaveBeenCalledWith('a', expect.objectContaining({ Art: 'CQ==', ArtMime: 'image/png' }));

    const removing = stage();
    await removing.edits.save([edited(song('a'), {})], record([song('a')]), { cover: 'remove' });
    expect(removing.deleted).toContain(`cloud/art/${key}`);
  });

  it('moves nothing when the names stay the same', async () => {
    const { covers, edits } = stage();
    await edits.save([edited(song('a'), { Genre: 'Rock' })], record([song('a')]));
    expect(covers.pictureAt).not.toHaveBeenCalled();
  });

  it('takes the heart of a favourite record with it', async () => {
    const { favorites, edits } = stage({}, true);
    await edits.save([edited(song('a'), { Album: 'Clandestino Deluxe' })], record([song('a')]));
    expect(favorites.markAlbum).toHaveBeenCalledTimes(1);
    const [renamed, on] = favorites.markAlbum.mock.calls[0] as unknown as [CloudAlbum, boolean];
    expect(on).toBe(true);
    expect(renamed.tracks[0]!.album).toBe('Clandestino Deluxe');
  });

  it('keeps the new names when a picture will not follow', async () => {
    const before = await coverKeyForTrack('Manu Chao', 'Manu Chao', 'Clandestino');
    const { transfers, edits } = stage({ [before]: { bytes: new Uint8Array([1]), mime: 'image/jpeg' } });
    transfers.put.mockRejectedValueOnce(new Error('no'));
    await expect(edits.save([edited(song('a'), { Album: 'New' })], record([song('a')]))).resolves.toBe(1);
  });
});
