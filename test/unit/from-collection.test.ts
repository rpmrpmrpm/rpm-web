import { describe, expect, it } from 'vitest';

import type { CloudTrack } from '../../src/api/wire';
import { albumFields, dominant, findAlbums } from '../../src/import/from-collection';
import type { CloudAlbum } from '../../src/library/albums';

const track = (album: string | null, tags: CloudTrack['tags']): CloudTrack => ({
  rpmId: 'id', sha256: 's', relativePath: null, originalSize: 1, title: 't', artist: 'a', album, addedAt: 1, tags, updatedAt: 1,
});
const record = (name: string, artist: string, tracks: CloudTrack[] = [], year = 0): CloudAlbum => ({ key: name, album: name, artist, tracks, addedAt: 1, year });

describe('the value of a record', () => {
  it('is what most of its tracks say', () => {
    expect(dominant(['Rock', 'Pop', 'Rock'])).toBe('Rock');
  });

  it('never lets a blank win', () => {
    expect(dominant(['', null, undefined, '  ', 'Rock'])).toBe('Rock');
    expect(dominant(['', null])).toBeNull();
  });

  it('gives the same answer on a tie, whatever the order', () => {
    expect(dominant(['Rock', 'Pop'])).toBe('Pop');
    expect(dominant(['Pop', 'Rock'])).toBe('Pop');
  });
});

describe('what a record gives to files', () => {
  it('gives what it says about itself', () => {
    const album = record('Clandestino', 'Manu Chao', [track('Clandestino', { albumArtist: 'Manu Chao', genre: 'Latin', discCount: 2 })], 1998);
    expect(albumFields(album)).toEqual({ Album: 'Clandestino', AlbumArtist: 'Manu Chao', Genre: 'Latin', Year: 1998, DiscCount: 2 });
  });

  it('leaves out what it does not know, so nothing the files have is blanked', () => {
    expect(albumFields(record('Clandestino', 'Manu Chao', [track('Clandestino', null)]))).toEqual({ Album: 'Clandestino' });
  });
});

describe('finding a record', () => {
  const albums = [record('Arrival', 'ABBA'), record('Clandestino', 'Manu Chao'), record('Abbey Road', 'The Beatles')];

  it('finds every word in the album or the artist', () => {
    expect(findAlbums(albums, 'manu clandest').map((album) => album.album)).toEqual(['Clandestino']);
    expect(findAlbums(albums, 'ABB').map((album) => album.album)).toEqual(['Arrival', 'Abbey Road']);
  });

  it('shows the whole shelf before anything is typed, up to a limit', () => {
    expect(findAlbums(albums, '  ')).toHaveLength(3);
    expect(findAlbums(Array.from({ length: 300 }, (_, index) => record(`A${index}`, 'B')), '')).toHaveLength(100);
  });
});
