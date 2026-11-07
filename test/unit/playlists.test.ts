import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { PlaylistGone, Playlists, type CloudPlaylist } from '../../src/library/playlists';

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
  return { playlists: new Playlists(api as never, () => 'new-id'), puts, deletes };
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
