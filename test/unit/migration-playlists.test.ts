import { describe, expect, it } from 'vitest';

import { readPlaylistFiles } from '../../src/migration/playlist-files';
import { expected, fixtureBytes, shape } from './migration-fixture';

const folder = '/Users/test/Playlists/';
const sample = (name: string) => ({ path: folder + name, bytes: fixtureBytes(`playlists/${name}`) });
const text = (path: string, body: string) => ({ path, bytes: new TextEncoder().encode(body) });
const local = (file: { kind: string; path?: string }) => (file.kind === 'local' ? file.path : undefined);

describe('playlist files', () => {
  it('match the expected result for the samples', () => {
    const library = readPlaylistFiles([sample('absolute.m3u'), sample('latin1.m3u'), sample('mac.pls'), sample('relative.m3u8')]);
    expect(shape(library)).toEqual(expected('playlistfiles'));
  });

  it('resolve relative paths against the playlist folder', () => {
    const library = readPlaylistFiles([sample('relative.m3u8')]);
    expect(library.tracks.map((t) => local(t.file))).toEqual([
      '/Users/test/Music/Artist A/Album A/01 Track One.flac',
      '/Users/test/Playlists/Artist B/Album B/02 Track Two.mp3',
    ]);
  });

  it('resolve Windows relative paths with backslashes', () => {
    const library = readPlaylistFiles([text('C:\\Playlists\\road.m3u', 'Music\\a.mp3\r\n..\\Other\\b.mp3\r\n./c.mp3\r\n')]);
    expect(library.tracks.map((t) => local(t.file))).toEqual(['C:\\Playlists\\Music\\a.mp3', 'C:\\Other\\b.mp3', 'C:\\Playlists\\c.mp3']);
  });

  it('take the artist and title from #EXTINF', () => {
    const [track] = readPlaylistFiles([sample('absolute.m3u')]).tracks;
    expect([track!.artist, track!.title, track!.durationSeconds]).toEqual(['Artist C', 'Track Three', 180]);
  });

  it('read a Latin-1 .m3u as Windows-1252', () => {
    const [track] = readPlaylistFiles([sample('latin1.m3u')]).tracks;
    expect(local(track!.file)).toBe('C:\\Music\\Beyoncé Tribute\\Café.mp3');
  });

  it('read .pls entries in their numbered order', () => {
    const library = readPlaylistFiles([text(folder + 'o.pls', '[playlist]\nFile2=/m/b.mp3\nFile1=/m/a.mp3\nNumberOfEntries=2\n')]);
    expect(library.playlists[0]!.trackIds).toEqual(['/m/a.mp3', '/m/b.mp3']);
  });

  it('skip web addresses and leave them unresolved', () => {
    const library = readPlaylistFiles([text(folder + 'r.m3u', '#EXTINF:-1,Radio\nhttp://radio.example.com/stream\n/m/a.mp3\n')]);
    expect(library.tracks).toHaveLength(1);
    expect(library.playlists[0]!.unresolved).toEqual(['http://radio.example.com/stream']);
    expect(library.skipped[0]!.reasonKey).toBe('Migration_SkipNotAFile');
  });
});
