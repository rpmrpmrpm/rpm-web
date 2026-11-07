import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { foldersIn, listsIn, mergeSongs, PlaylistGone, Playlists, type CloudPlaylist } from '../../src/library/playlists';

function fake(stored: CloudPlaylist[], refuse = 0) {
  const puts: { id: string; body: Record<string, unknown> }[] = [];
  const deletes: string[] = [];
  let conflicts = refuse;
  const api = {
    json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => {
      if (path === 'cloud/moodlists') throw new ApiError(404, 'none');
      return read({ playlists: stored });
    }),
    call: vi.fn(async (path: string, options: { method: string; body?: Record<string, unknown> }) => {
      const id = path.split('/').pop()!;
      if (options.method === 'DELETE') {
        deletes.push(id);
        return new Response();
      }
      if (conflicts-- > 0) {
        stored[0]!.trackIds = [...stored[0]!.trackIds, 'theirs'];
        stored[0]!.updatedAt += 1;
        throw new ApiError(409, 'changed');
      }
      puts.push({ id, body: options.body! });
      return new Response();
    }),
  };
  return { playlists: new Playlists(api as never, { put: async () => {} }, () => 'new-id'), puts, deletes };
}

const list = (fields: Partial<CloudPlaylist> = {}): CloudPlaylist => ({ playlistId: 'p', name: 'Mine', trackIds: ['a', 'b'], folder: ['Folder'], updatedAt: 7, ...fields });

describe('playlists', () => {
  it('makes a new one that must not overwrite anything', async () => {
    const { playlists, puts } = fake([]);
    const made = await playlists.create('  Fresh  ', ['a']);
    expect(made.playlistId).toBe('new-id');
    expect(puts[0]).toEqual({ id: 'new-id', body: { name: 'Fresh', trackIds: ['a'], folder: [], ifUnchangedSince: 0 } });
  });

  it('adds what is not there yet, on the copy it just read', async () => {
    const { playlists, puts } = fake([list()]);
    await playlists.add('p', ['b', 'c']);
    expect(puts[0]!.body).toMatchObject({ trackIds: ['a', 'b', 'c'], ifUnchangedSince: 7, folder: ['Folder'], name: 'Mine' });
  });

  it('makes the same change to what the store holds after a conflict', async () => {
    const { playlists, puts } = fake([list()], 1);
    await playlists.add('p', ['c']);
    expect(puts[0]!.body).toMatchObject({ trackIds: ['a', 'b', 'theirs', 'c'], ifUnchangedSince: 8 });
  });

  it('gives up after three tries, and says so', async () => {
    const { playlists, puts } = fake([list()], 5);
    await expect(playlists.add('p', ['c'])).rejects.toThrow(ApiError);
    expect(puts).toHaveLength(0);
  });

  it('removes the copy at that place, for a track on the list twice', async () => {
    const { playlists, puts } = fake([list({ trackIds: ['a', 'b', 'a'] })]);
    await playlists.removeAt('p', 'a', 2);
    expect(puts[0]!.body.trackIds).toEqual(['a', 'b']);
  });

  it('finds the track when the list has moved under the place', async () => {
    const { playlists, puts } = fake([list({ trackIds: ['x', 'a'] })]);
    await playlists.removeAt('p', 'a', 0);
    expect(puts[0]!.body.trackIds).toEqual(['x']);
  });

  it('renames, keeping the tracks', async () => {
    const { playlists, puts } = fake([list()]);
    await playlists.rename('p', ' Other ');
    expect(puts[0]!.body).toMatchObject({ name: 'Other', trackIds: ['a', 'b'] });
  });

  it('says when a playlist has gone', async () => {
    const { playlists } = fake([]);
    await expect(playlists.add('p', ['c'])).rejects.toThrow(PlaylistGone);
  });

  it('reads no generated lists as none, not as a failure', async () => {
    const { playlists } = fake([]);
    expect(await playlists.generated()).toEqual([]);
  });

  it('deletes', async () => {
    const { playlists, deletes } = fake([list()]);
    await playlists.remove('p');
    expect(deletes).toEqual(['p']);
  });
});

describe('two heads changing one running order', () => {
  it('leaves a list nobody changed', () => {
    expect(mergeSongs(['a', 'b'], ['a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('takes the whole of the only side that moved', () => {
    expect(mergeSongs(['a', 'b'], ['a', 'b'], ['b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
    expect(mergeSongs(['a', 'b'], ['b', 'a', 'c'], ['a', 'b'])).toEqual(['b', 'a', 'c']);
  });

  it('keeps a reorder made here against an unchanged store', () => {
    expect(mergeSongs(['a', 'b', 'c'], ['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('keeps what both heads added', () => {
    expect(mergeSongs(['a'], ['a', 'x'], ['a', 'y'])).toEqual(['a', 'y', 'x']);
  });

  it('honours a removal on either side against an addition on the other', () => {
    expect(mergeSongs(['a', 'b'], ['a'], ['a', 'b', 'y'])).toEqual(['a', 'y']);
    expect(mergeSongs(['a', 'b'], ['a', 'b', 'x'], ['a'])).toEqual(['a', 'x']);
  });

  it('counts both heads removing a song as one removal', () => {
    expect(mergeSongs(['a', 'a', 'b'], ['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('counts both heads adding a song as one change', () => {
    expect(mergeSongs(['a'], ['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeSongs(['a'], ['a', 'a'], ['a', 'a'])).toEqual(['a', 'a']);
  });

  it('lets the published order win when both reordered', () => {
    expect(mergeSongs(['a', 'b', 'c'], ['c', 'b', 'a'], ['b', 'c', 'a'])).toEqual(['b', 'c', 'a']);
  });

  it('puts an addition after the published order', () => {
    expect(mergeSongs(['a', 'b'], ['a', 'b', 'x'], ['b', 'a'])).toEqual(['b', 'a', 'x']);
  });

  it('counts copies', () => {
    expect(mergeSongs(['a', 'b'], ['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'a', 'b']);
    expect(mergeSongs(['a', 'a'], ['a'], ['a', 'a', 'y'])).toEqual(['a', 'y']);
  });

  it('empties a list emptied on one side, and keeps what the other added', () => {
    expect(mergeSongs(['a', 'b'], [], ['a', 'b'])).toEqual([]);
    expect(mergeSongs(['a', 'b'], ['a', 'b'], [])).toEqual([]);
    expect(mergeSongs(['a', 'b'], [], ['a', 'b', 'y'])).toEqual(['y']);
  });

  it('removes nothing with no ancestor', () => {
    expect(mergeSongs(null, ['a', 'x'], ['a', 'y'])).toEqual(['a', 'y', 'x']);
    expect(mergeSongs(null, ['a', 'a'], ['a'])).toEqual(['a', 'a']);
  });
});

describe('moving a list', () => {
  it('writes the new order on the copy it just read', async () => {
    const { playlists, puts } = fake([list()]);
    await playlists.reorder('p', ['a', 'b'], ['b', 'a']);
    expect(puts[0]!.body).toMatchObject({ trackIds: ['b', 'a'], ifUnchangedSince: 7 });
  });

  it('keeps a song added elsewhere since the list was shown', async () => {
    const { playlists, puts } = fake([list({ trackIds: ['a', 'b', 'phone'] })]);
    await playlists.reorder('p', ['a', 'b'], ['b', 'a']);
    expect(puts[0]!.body.trackIds).toEqual(['a', 'b', 'phone']);
  });

  it('merges again after a refusal', async () => {
    const { playlists, puts } = fake([list()], 1);
    await playlists.reorder('p', ['a', 'b'], ['a']);
    expect(puts[0]!.body.trackIds).toEqual(['a', 'theirs']);
  });

  it('files a list and leaves its songs alone', async () => {
    const { playlists, puts } = fake([list()]);
    await playlists.refile('p', ['Moods', 'Slow']);
    expect(puts[0]!.body).toMatchObject({ folder: ['Moods', 'Slow'], trackIds: ['a', 'b'], name: 'Mine' });
  });

  it('keeps the folder through any other change', async () => {
    const { playlists, puts } = fake([list()]);
    await playlists.rename('p', 'New');
    expect(puts[0]!.body.folder).toEqual(['Folder']);
  });
});

describe('folders', () => {
  const lists = [list({ playlistId: '1', folder: [] }), list({ playlistId: '2', folder: ['Moods'] }), list({ playlistId: '3', folder: ['Moods', 'Slow'] }), list({ playlistId: '4', folder: ['Decades'] })];

  it('lists what is directly in a folder', () => {
    expect(listsIn(lists, []).map((row) => row.playlistId)).toEqual(['1']);
    expect(listsIn(lists, ['Moods']).map((row) => row.playlistId)).toEqual(['2']);
  });

  it('finds the folders under a path, once each', () => {
    expect(foldersIn(lists, [])).toEqual(['Decades', 'Moods']);
    expect(foldersIn(lists, ['Moods'])).toEqual(['Slow']);
    expect(foldersIn(lists, ['Decades'])).toEqual([]);
  });

  it('shows a folder made here before anything is in it', () => {
    expect(foldersIn(lists, [], [['Empty']])).toEqual(['Decades', 'Empty', 'Moods']);
  });
});

describe('a list\'s picture', () => {
  it('asks once, and takes a failure for no picture', async () => {
    const json = vi.fn(async () => {
      throw new ApiError(404, 'none');
    });
    const playlists = new Playlists({ json, call: vi.fn() } as never);
    expect(await playlists.picture('p')).toBeNull();
    expect(await playlists.picture('p')).toBeNull();
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('asks again after a new one is chosen', async () => {
    const json = vi.fn(async (_path: string, read: (raw: unknown) => unknown) => read({ url: 'https://store/picture' }));
    const put = vi.fn(async () => {});
    const playlists = new Playlists({ json, call: vi.fn() } as never, { put });
    await playlists.picture('p');
    await playlists.choosePicture('p', new Uint8Array(3), 'image/png');
    expect(put).toHaveBeenCalledWith('https://store/picture', expect.any(Uint8Array), { contentType: 'image/png' });
    await playlists.picture('p');
    expect(json.mock.calls.filter(([path]) => path === 'cloud/playlist-art/p')).toHaveLength(2);
  });

  it('goes back to the automatic cover', async () => {
    const call = vi.fn(async () => new Response());
    const playlists = new Playlists({ json: vi.fn(async () => null), call } as never);
    await playlists.removePicture('p');
    expect(call).toHaveBeenCalledWith('cloud/playlist-art/p', { method: 'DELETE' });
  });
});
