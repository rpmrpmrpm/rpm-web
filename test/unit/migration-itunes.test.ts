import { describe, expect, it } from 'vitest';

import { matchPicked } from '../../src/migration/itunes';
import { readITunesLibrary } from '../../src/migration/itunes';
import type { SourceTrack } from '../../src/migration/model';
import { expected, fixture, shape } from './migration-fixture';

const itunes = () => readITunesLibrary(fixture('itunes/Library.xml'), 'itunes');
const musicbee = () => readITunesLibrary(fixture('musicbee/iTunes Music Library.xml'), 'musicbee');
const track = (tracks: SourceTrack[], id: string) => tracks.find((t) => t.sourceId === id)!;

describe('the iTunes library file', () => {
  it('matches the expected result for the Apple Music sample', async () => {
    expect(shape(await itunes())).toEqual(expected('itunes'));
  });

  it('matches the expected result for the MusicBee sample', async () => {
    expect(shape(await musicbee())).toEqual(expected('musicbee'));
  });

  it('reads a rating computed from the album as no rating', async () => {
    expect(track((await itunes()).tracks, 'AAAA000000000105').rating).toBe(0);
  });

  it('takes Loved and Favorited as favourites', async () => {
    const { tracks } = await itunes();
    expect(track(tracks, 'AAAA000000000101').favorite).toBe(true);
    expect(track(tracks, 'AAAA000000000102').favorite).toBe(true);
    expect(track(tracks, 'AAAA000000000103').favorite).toBe(false);
  });

  it('keeps half stars', async () => {
    const { tracks } = await musicbee();
    expect(track(tracks, '1').rating).toBe(1);
    expect(track(tracks, '3').rating).toBe(7);
  });

  it('unescapes the location and writes it in normal form C', async () => {
    const { tracks } = await itunes();
    const cafe = track(tracks, 'AAAA000000000105').file;
    expect(cafe.kind === 'local' && cafe.path.endsWith('Café Society/Le Café/01 Café.flac')).toBe(true);
    expect(cafe.kind === 'local' && cafe.path === cafe.path.normalize('NFC')).toBe(true);
  });

  it('turns a Windows location into a drive path', async () => {
    const file = track((await musicbee()).tracks, '1').file;
    expect(file).toEqual({ kind: 'local', path: 'C:\\Users\\Test\\Music\\Artist F\\Album F\\01 One.mp3' });
  });

  it('skips the built-in lists and folders, and keeps the folder chain', async () => {
    const { playlists } = await itunes();
    expect(playlists.map((p) => p.name)).toEqual(['Calm', 'Late', 'Top Rated', 'Party']);
    expect(playlists.find((p) => p.name === 'Late')!.folder).toEqual(['Moods', 'Evening']);
  });

  it('flags a smart playlist and keeps its items', async () => {
    const top = (await itunes()).playlists.find((p) => p.name === 'Top Rated')!;
    expect(top.smart).toBe(true);
    expect(top.trackIds).toEqual(['AAAA000000000101', 'AAAA000000000102']);
  });

  it('reads 20,000 tracks in under 5 seconds', async () => {
    const parts = ['<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Library Persistent ID</key><string>1111222233334444</string><key>Tracks</key><dict>'];
    for (let i = 1; i <= 20_000; i++) {
      parts.push(`<key>${i}</key><dict><key>Track ID</key><integer>${i}</integer><key>Name</key><string>Song ${i}</string>`
        + `<key>Artist</key><string>Band ${i % 300}</string><key>Album</key><string>Record ${i % 2000}</string>`
        + `<key>Total Time</key><integer>200000</integer><key>Size</key><integer>5000000</integer>`
        + `<key>Play Count</key><integer>${i % 50}</integer><key>Rating</key><integer>${(i % 6) * 20}</integer>`
        + `<key>Date Added</key><date>2015-01-01T00:00:00Z</date><key>Persistent ID</key><string>P${String(i).padStart(15, '0')}</string>`
        + `<key>Location</key><string>file:///Users/test/Music/Band%20${i % 300}/Record%20${i % 2000}/${i}.mp3</string></dict>`);
    }
    parts.push('</dict><key>Playlists</key><array></array></dict></plist>');
    const started = performance.now();
    const library = await readITunesLibrary(parts.join(''), 'itunes');
    expect(library.tracks).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('finding the picked files', () => {
  it('matches each track by the longest end of its path, at least a folder and the file name', async () => {
    const library = await itunes();
    const picked = [
      { file: new File([], '01 Track One.m4a'), path: 'Music/Artist A/Album A/01 Track One.m4a' },
      { file: new File([], '02 Track Two.m4a'), path: 'Music/Other/Album A/02 Track Two.m4a' },
      { file: new File([], '01 Track Eleven.aiff'), path: 'Elsewhere/01 Track Eleven.aiff' },
    ];
    const found = matchPicked(library, picked);
    expect(found.get('AAAA000000000101')?.path).toBe('Music/Artist A/Album A/01 Track One.m4a');
    expect(found.get('AAAA000000000102')?.path).toBe('Music/Other/Album A/02 Track Two.m4a');
    expect(found.has('AAAA000000000111')).toBe(false);
  });
});
