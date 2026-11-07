import { describe, expect, it } from 'vitest';

import { readTrack, type CloudTrack, type CloudTrackTags } from '../../src/api/wire';
import { addedOf, groupAlbums, sortAlbums, yearOf } from '../../src/library/albums';
import { coverKey, coverKeyForTrack, coverSpellings, discKeyForTrack } from '../../src/library/art-key';
import { albumArtistOf, albumKey, albumNameOf, folderOf, normalizedAlbumName } from '../../src/library/grouping';
import { byDisc } from '../../src/library/tracklist';

let next = 0;
function row(path: string | null, fields: Partial<CloudTrack> = {}, tags: CloudTrackTags = {}): CloudTrack {
  return readTrack({ rpmId: `id-${next++}`, relativePath: path, ...fields, tags });
}

describe('which rows are one album', () => {
  it('a compilation is one album however many artists play on it', () => {
    const rows = [
      row('Various Artists/Now 22/01.mp3', { artist: 'Snap!' }, { albumArtist: 'Various Artists' }),
      row('Various Artists/Now 22/02.mp3', { artist: 'Madonna' }, { albumArtist: 'Various Artists' }),
    ];
    expect(groupAlbums(rows)).toHaveLength(1);
    expect(albumArtistOf(rows, 'Various Artists/Now 22')).toBe('Various Artists');
  });

  it('a merged multi-disc set is one album, with its discs in order', () => {
    const rows = [
      row('A/Set/2-01.flac', { title: 'd2t1' }, { discNumber: 2, trackNumber: 1 }),
      row('A/Set/1-02.flac', { title: 'd1t2' }, { discNumber: 1, trackNumber: 2 }),
      row('A/Set/1-01.flac', { title: 'd1t1' }, { discNumber: 1, trackNumber: 1 }),
    ];
    const albums = groupAlbums(rows);
    expect(albums).toHaveLength(1);
    expect(albums[0]!.tracks.map((t) => t.title)).toEqual(['d1t1', 'd1t2', 'd2t1']);
  });

  it('discs filed as separate albums stay separate', () => {
    expect(groupAlbums([row('A/Set (Disc 1)/1.flac'), row('A/Set (Disc 2)/1.flac')])).toHaveLength(2);
  });

  it('two artists with an identically named album are two albums', () => {
    expect(groupAlbums([row('A/Greatest Hits/1.flac'), row('B/Greatest Hits/1.flac')])).toHaveLength(2);
  });

  it('the folder decides whatever the tags disagree about', () => {
    expect(groupAlbums([row('A/X/1.flac', { album: 'One' }), row('A/X/2.flac', { album: 'Two' })])).toHaveLength(1);
  });

  it('case and separators do not split a folder', () => {
    expect(groupAlbums([row('A/X/1.flac'), row('a\\x\\2.flac')])).toHaveLength(1);
  });

  it('tracks loose at the library root are one album', () => {
    expect(groupAlbums([row('one.flac'), row('two.flac')])).toHaveLength(1);
    expect(folderOf('stray one.flac')).toBe('');
  });

  it('without a path the tags answer, and disc decorations come off', () => {
    expect(albumKey(null, 'A', null, 'Set (Disc 1)')).toBe(albumKey(null, 'A', null, 'Set (Disc 2)'));
  });

  it('a blank album artist falls back to the track artist', () => {
    expect(albumKey(null, '   ', 'Someone', 'R')).toBe(albumKey(null, 'Someone', null, 'R'));
  });

  it('a name that is only a decoration keeps it', () => {
    expect(normalizedAlbumName('Disc 2')).toBe('Disc 2');
    expect(normalizedAlbumName('Set - CD1')).toBe('Set');
    expect(normalizedAlbumName('Set [Disk 03]')).toBe('Set');
  });

  it('the folder names an album no file carries a tag for', () => {
    const rows = [row('Manu Chao/Clandestino/1.mp3')];
    expect(albumNameOf(rows, 'Manu Chao/Clandestino')).toBe('Clandestino');
    expect(albumArtistOf(rows, 'Manu Chao/Clandestino')).toBe('Manu Chao');
  });
});

describe('the tracklist', () => {
  const disc = (t: { d: number }) => t.d;
  const track = (t: { n: number }) => t.n;

  it('puts an untagged track last inside its own disc', () => {
    const sections = byDisc([{ d: 1, n: 0, t: 'nothing' }, { d: 1, n: 2, t: 'd1t2' }, { d: 2, n: 1, t: 'd2t1' }, { d: 1, n: 1, t: 'd1t1' }], disc, track);
    expect(sections.map((s) => s.discNumber)).toEqual([1, 2]);
    expect(sections[0]!.tracks.map((t) => t.t)).toEqual(['d1t1', 'd1t2', 'nothing']);
  });

  it('reads an untagged disc as disc 1, so a single disc is one section', () => {
    expect(byDisc([{ d: 0, n: 1 }, { d: 1, n: 2 }], disc, track)).toHaveLength(1);
  });

  it('reads tracks with no numbers alphabetically', () => {
    const albums = groupAlbums([row('A/X/z.flac', { title: 'Zebra' }), row('A/X/a.flac', { title: 'apple' })]);
    expect(albums[0]!.tracks.map((t) => t.title)).toEqual(['apple', 'Zebra']);
  });
});

describe('the order of the wall', () => {
  const album = (artist: string, name: string, addedAt = 0, year = 0) => ({ key: name, album: name, artist, tracks: [], addedAt, year });

  it('puts records with no year last, not first', () => {
    const order = sortAlbums([album('A', 'none'), album('B', 'old', 0, 1970), album('C', 'new', 0, 2020)], 'Year');
    expect(order.map((a) => a.album)).toEqual(['new', 'old', 'none']);
  });

  it('falls back to the shelf order', () => {
    const order = sortAlbums([album('B', 'x', 5), album('A', 'y', 5), album('C', 'z', 9)], 'Added');
    expect(order.map((a) => a.artist)).toEqual(['C', 'A', 'B']);
  });

  it('ignores case', () => {
    expect(sortAlbums([album('beta', 'x'), album('Alpha', 'y')], 'Artist')[0]!.artist).toBe('Alpha');
  });

  it('puts the most played first, and what was never played after it by shelf', () => {
    const albums = [album('B', 'never'), album('A', 'never too'), album('C', 'loved')];
    const plays = { loved: 9 } as Record<string, number>;
    const order = sortAlbums(albums, 'Plays', (held) => plays[held.key] ?? 0);
    expect(order.map((held) => held.key)).toEqual(['loved', 'never too', 'never']);
  });

  it('dates a record by its newest track', () => {
    expect(addedOf([row('a', { addedAt: 5 }), row('b', { addedAt: 9 })])).toBe(9);
  });

  it('takes the year most tracks agree on, the earlier on a tie', () => {
    expect(yearOf([row('a', {}, { year: 1999 }), row('b', {}, { year: 2005 }), row('c', {}, { year: 2005 })])).toBe(2005);
    expect(yearOf([row('a', {}, { year: 2005 }), row('b', {}, { year: 1999 })])).toBe(1999);
    expect(yearOf([row('a')])).toBe(0);
  });
});

describe('the cover key, a contract with the other apps', () => {
  it('matches what the desktop writes', async () => {
    expect(await coverKey('Manu Chao', 'Clandestino')).toBe('d90d382db82e7ba38c335b59ae3eaf33');
    expect(await discKeyForTrack('ABBA', 'Someone', ' Arrival ')).toBe('f245c4a44d16d5ca62f1abdf5da5458d');
    expect(await discKeyForTrack('  ', 'ABBA', 'Arrival')).toBe('f245c4a44d16d5ca62f1abdf5da5458d');
  });

  it('is the same however the name is written', async () => {
    expect(await coverKey('  MANU CHAO ', 'clandestino ')).toBe('d90d382db82e7ba38c335b59ae3eaf33');
  });

  it('is 32 hex characters whatever the record is called', async () => {
    for (const name of ['../../../etc/passwd', 'AC/DC', '🎵 emoji 🎵', '']) {
      expect(await coverKey('Artist', name)).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('a blank album artist is not an album artist', async () => {
    expect(await coverKeyForTrack('   ', 'Someone', 'Record')).toBe(await coverKey('Someone', 'Record'));
  });

  it('finds a form that only a later track knows', async () => {
    const tracks = [
      row('a', { artist: 'One', album: 'R' }),
      row('b', { artist: 'One', album: 'R' }, { albumArtist: 'Everyone' }),
    ];
    const spellings = await coverSpellings(tracks);
    expect(spellings).toContain(await coverKey('One', 'R'));
    expect(spellings).toContain(await coverKey('Everyone', 'R'));
    expect(spellings).toHaveLength(2);
  });
});
